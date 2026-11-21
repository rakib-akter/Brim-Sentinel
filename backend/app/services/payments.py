"""PaymentService (FR-07): prepare/schedule/release/settle **SIMULATED** payments.

No real payment rail is contacted. Release runs inside one BEGIN IMMEDIATE transaction that
re-reads the invoice version, holds, approvals, verified route and the releaser's own prior
approvals; idempotency keys replay the original result and reject changed payloads."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.core.permissions import require
from app.db.models import (
    IdempotencyRecord,
    Invoice,
    Payment,
    PaymentMethodChange,
    PaymentRoute,
    User,
    VendorBankChange,
    utcnow,
)
from app.services import approval_policy, audit, lifecycle as lc, pipeline
from app.services.validation import OPEN_BANK_CHANGE_STATES


def get_payment(session: Session, payment_id: str) -> Payment:
    p = session.get(Payment, payment_id)
    if p is None:
        raise NotFound("PAYMENT_NOT_FOUND", f"Payment {payment_id} not found.")
    return p


def _active_change(session: Session, inv: Invoice) -> PaymentMethodChange | None:
    return session.scalar(select(PaymentMethodChange).where(
        PaymentMethodChange.invoice_id == inv.id, PaymentMethodChange.invoice_version == inv.current_version,
        PaymentMethodChange.state == "AUTHORIZED"))


def _route_for(session: Session, inv: Invoice, method: str | None) -> PaymentRoute:
    v = pipeline.current_version(session, inv)
    remit = v.remit or {}
    pmc = _active_change(session, inv)
    if pmc is not None:
        # An authorized EFT → CARD change binds this version to that exact verified card route.
        if method not in {None, "CARD"}:
            raise Unprocessable("METHOD_CHANGE_REQUIRES_CARD", f"Method change {pmc.id} was authorized for this "
                                "version; it can only be paid through the verified card route.",
                                {"method_change_id": pmc.id})
        route = session.get(PaymentRoute, pmc.route_id)
        if route is None or route.status != "VERIFIED":
            raise Unprocessable("CARD_ROUTE_UNAVAILABLE", "The authorized card route is no longer verified.")
        return route
    invoice_method = remit.get("method") or "EFT"
    if method is not None and method != invoice_method:
        raise Unprocessable("METHOD_CHANGE_NOT_AUTHORIZED",
                            f"The invoice asks for {invoice_method}. Paying by {method} requires an authorized "
                            "payment-method change for this invoice version (finance manager, two-person control).",
                            {"invoice_method": invoice_method, "requested_method": method})
    method = invoice_method
    if method == "EFT":
        fp = remit.get("account_fingerprint")
        route = session.scalar(select(PaymentRoute).where(PaymentRoute.vendor_id == inv.vendor_id,
                                                          PaymentRoute.method == "EFT",
                                                          PaymentRoute.account_fingerprint == fp)) if fp else None
        if route is None or route.status != "VERIFIED":
            raise Unprocessable("ROUTE_NOT_VERIFIED", "No independently verified EFT route matches the invoice's "
                                "remit-to account.", {"method": "EFT"})
        return route
    if method == "CARD":
        route = session.scalar(select(PaymentRoute).where(PaymentRoute.vendor_id == inv.vendor_id,
                                                          PaymentRoute.method == "CARD",
                                                          PaymentRoute.status == "VERIFIED"))
        if route is None:
            raise Unprocessable("CARD_ROUTE_UNAVAILABLE",
                                "No separately verified Brim virtual-card route exists for this vendor. Card "
                                "transaction history alone never establishes merchant ownership, so no route is "
                                "inferred.", {"method": "CARD"})
        return route
    if method == "CHEQUE":
        route = session.scalar(select(PaymentRoute).where(PaymentRoute.vendor_id == inv.vendor_id,
                                                          PaymentRoute.method == "CHEQUE",
                                                          PaymentRoute.status == "VERIFIED"))
        if route is None:
            raise Unprocessable("ROUTE_NOT_VERIFIED", "No verified cheque route for this vendor.")
        return route
    raise Unprocessable("METHOD_INVALID", "method must be EFT, CARD or CHEQUE.")


def _live_gates(session: Session, inv: Invoice, *, expected_version: int) -> list[str]:
    """Re-read every hard gate. Returns blocked reasons (empty == clear). An open bank change
    blocks every payment of the vendor unless this exact version was authorized to be paid by
    the verified card route (then EFT is not used at all)."""
    reasons = []
    v = pipeline.current_version(session, inv)
    if expected_version != v.version:
        raise Conflict("INVOICE_VERSION_CONFLICT", "This invoice changed. Refresh before continuing.",
                       {"expected_version": expected_version, "current_version": v.version})
    if inv.kind != "invoice" or (v.total_minor or 0) <= 0:
        reasons.append("Credit notes and non-positive totals are never paid.")
    for f in pipeline.blocking_findings(session, inv.id, v.version):
        reasons.append(f"{f.code}: {f.title}")
    open_bc = session.scalars(select(VendorBankChange).where(VendorBankChange.vendor_id == inv.vendor_id,
                                                             VendorBankChange.state.in_(OPEN_BANK_CHANGE_STATES))).all()
    pmc = _active_change(session, inv)
    card_ok = pmc is not None and (r := session.get(PaymentRoute, pmc.route_id)) is not None and r.status == "VERIFIED"
    for bc in open_bc:
        if not card_ok:
            reasons.append(f"BANK_CHANGE_UNVERIFIED: bank change {bc.id} is {bc.state}")
    if not pipeline.all_approved(session, inv.id, v.version):
        reasons.append("Required approvals for the current version are incomplete.")
    return sorted(set(reasons))


def prepare(session: Session, actor: User, inv: Invoice, *, expected_version: int, method: str | None) -> Payment:
    require(actor, "payment.prepare")
    if inv.source_kind == "historical_ledger":
        raise Conflict("HISTORICAL_READ_ONLY", "Historical ledger records are read-only.")
    if inv.lifecycle_state not in {lc.APPROVED, lc.FAILED}:
        raise Conflict("INVALID_TRANSITION", f"Invoice is {inv.lifecycle_state}; only APPROVED invoices can be "
                       "scheduled.")
    blocked = _live_gates(session, inv, expected_version=expected_version)
    if blocked:
        raise Unprocessable("HOLDS_UNRESOLVED", "Payment cannot be scheduled.", {"blocked_reasons": blocked})
    v = pipeline.current_version(session, inv)
    route = _route_for(session, inv, method)
    users = pipeline.users_map(session)
    approvers = {d.actor_id for d in pipeline.decisions(session, inv.id, v.version).values()}
    pmc = _active_change(session, inv)
    excluded = approvers | {actor.id} | ({v.requester_id} if v.requester_id else set()) | (
        {pmc.requested_by, pmc.decided_by} - {None} if pmc else set())
    rel = approval_policy.eligible_releasers(v.amount_cad_minor or 0, users, excluded)
    if not rel:
        raise Unprocessable("NO_ELIGIBLE_RELEASER", "Nobody independent of the approvers and preparer holds release "
                            "authority for this amount. Payment stays held.", {"policy_ids": ["P09", "P10", "P11"]})
    n = (session.scalar(select(func.count()).select_from(Payment).where(Payment.source == "simulation")) or 0) + 1
    p = Payment(id=f"SIM-PAY-{n:05d}", invoice_id=inv.id, invoice_version=v.version, vendor_id=inv.vendor_id,
                method=route.method, route_id=route.id, currency=v.currency or "CAD", amount_minor=v.total_minor or 0,
                amount_cad_minor=v.amount_cad_minor or 0, state="SCHEDULED", simulation=True, source="simulation",
                prepared_by=actor.id, scheduled_date=v.due_date)
    session.add(p)
    session.flush()
    lc.transition(session, inv, lc.SCHEDULED, actor=actor, reason=f"simulated {route.method} payment scheduled")
    audit.record(session, actor=actor, action="payment.scheduled", object_type="payment", object_id=p.id,
                 object_version=v.version, invoice_id=inv.id, after="SCHEDULED",
                 policy_ids=["P09"] if p.amount_cad_minor <= 100_000_00 else ["P10"],
                 evidence=[{"type": "payment_route", "ref": route.id, "provenance": route.provenance}],
                 details={"simulation": True, "eligible_releasers": rel, "method": route.method,
                          "method_change_id": pmc.id if pmc else None})
    return p


def _hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def release(session: Session, actor: User, payment_id: str, *, idempotency_key: str,
            expected_invoice_version: int, serialize) -> dict[str, Any]:  # noqa: ANN001
    if not idempotency_key or len(idempotency_key) > 200:
        raise Unprocessable("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header (≤ 200 chars) is required.")
    req_hash = _hash({"payment_id": payment_id, "expected_invoice_version": expected_invoice_version})
    rec = session.scalar(select(IdempotencyRecord).where(IdempotencyRecord.actor_id == actor.id,
                                                         IdempotencyRecord.operation == "payment.release",
                                                         IdempotencyRecord.key == idempotency_key))
    if rec is not None:
        if rec.request_hash != req_hash:
            raise Conflict("IDEMPOTENCY_KEY_REUSED", "This idempotency key was used with a different request.")
        audit.record(session, actor=actor, action="payment.release_replayed", object_type="payment",
                     object_id=payment_id, result="INFO", details={"note": "Idempotent replay; no second payment."})
        return {**rec.response, "idempotent_replay": True}

    require(actor, "payment.release")
    p = get_payment(session, payment_id)
    if p.source != "simulation":
        raise Conflict("HISTORICAL_READ_ONLY", "Historical payments cannot be released.")
    inv = session.get(Invoice, p.invoice_id)
    assert inv is not None
    if p.state in {"RELEASED", "SETTLED"}:
        raise Conflict("ALREADY_RELEASED", "This payment was already released; no second payment is created.",
                       {"payment_id": p.id, "state": p.state})
    if p.state != "SCHEDULED":
        raise Conflict("INVALID_TRANSITION", f"Payment is {p.state}.")
    if p.invoice_version != inv.current_version:
        raise Conflict("INVOICE_VERSION_CONFLICT", "Invoice changed after scheduling.",
                       {"payment_version": p.invoice_version, "current_version": inv.current_version})
    blocked = _live_gates(session, inv, expected_version=expected_invoice_version)
    v = pipeline.current_version(session, inv)
    if (v.total_minor, v.currency) != (p.amount_minor, p.currency):
        blocked.append("Amount or currency changed since scheduling.")
    route = session.get(PaymentRoute, p.route_id) if p.route_id else None
    if route is None or route.status != "VERIFIED":
        blocked.append("Payment route is not verified.")
    pmc = _active_change(session, inv)
    if pmc is not None and p.route_id != pmc.route_id:
        blocked.append(f"Payment route differs from the route authorized by {pmc.id}.")
    if pmc is None and route is not None and route.method != ((v.remit or {}).get("method") or "EFT"):
        blocked.append("Payment method differs from the invoice and no method change is authorized.")
    if blocked:
        raise Unprocessable("HOLDS_UNRESOLVED", "Release blocked; payment stays held.", {"blocked_reasons": blocked})
    roles = approval_policy.release_authority_roles(p.amount_cad_minor)
    policy = "P09" if p.amount_cad_minor <= 100_000_00 else "P10"
    if actor.role not in roles:
        raise Forbidden("RELEASE_LIMIT_EXCEEDED",
                        f"Role {actor.role} cannot release CAD {p.amount_cad_minor / 100:,.2f} ({policy}: {roles}).",
                        {"policy_ids": [policy], "required_roles": roles})
    approvers = {d.actor_id for d in pipeline.decisions(session, inv.id, v.version).values()}
    if actor.id in approvers:
        raise Forbidden("APPROVER_CANNOT_RELEASE", "You approved this invoice version; separation of duties (P11) "
                        "forbids you from releasing it.", {"policy_ids": ["P11"]})
    if actor.id == v.requester_id:
        raise Forbidden("REQUESTER_CANNOT_RELEASE", "The requester cannot release their own invoice.")
    if actor.id == p.prepared_by:
        raise Forbidden("PREPARER_CANNOT_RELEASE", "The person who scheduled the payment cannot release it.")
    if pmc is not None and actor.id in {pmc.requested_by, pmc.decided_by}:
        raise Forbidden("METHOD_CHANGE_PARTY_CANNOT_RELEASE", f"You requested or authorized method change {pmc.id}; "
                        "an independent person must release this payment.", {"method_change_id": pmc.id})
    if actor.id == v.created_by and v.provenance == "manual":
        raise Forbidden("VERSION_AUTHOR_CANNOT_RELEASE", "You made the edits that created this invoice version; an "
                        "independent person must release it (maker-checker).")
    p.state = "RELEASED"
    p.released_by = actor.id
    p.released_at = utcnow()
    p.idempotency_key_hash = hashlib.sha256(idempotency_key.encode()).hexdigest()
    p.reference = f"SIMULATED-{p.method}-{p.id}"
    lc.transition(session, inv, lc.RELEASED, actor=actor, reason=f"simulated release by {actor.id}",
                  policy_ids=[policy, "P11"])
    session.flush()
    response = serialize(p)
    session.add(IdempotencyRecord(actor_id=actor.id, operation="payment.release", key=idempotency_key,
                                  request_hash=req_hash, response=response))
    audit.record(session, actor=actor, action="payment.released", object_type="payment", object_id=p.id,
                 object_version=v.version, invoice_id=inv.id, before="SCHEDULED", after="RELEASED",
                 policy_ids=[policy, "P11"],
                 evidence=[{"type": "approval", "ref": d.id} for d in pipeline.decisions(session, inv.id, v.version).values()]
                 + [{"type": "payment_route", "ref": p.route_id}]
                 + [{"type": "finding_run", "ref": f"{inv.id}:v{v.version}"}],
                 details={"simulation": True, "amount_minor": p.amount_minor, "currency": p.currency,
                          "amount_cad_minor": p.amount_cad_minor, "approvers": sorted(approvers),
                          "prepared_by": p.prepared_by})
    return {**response, "idempotent_replay": False}


def settle(session: Session, actor: User, payment_id: str, *, outcome: str) -> Payment:
    require(actor, "payment.settle_simulation")
    p = get_payment(session, payment_id)
    if p.source != "simulation":
        raise Conflict("HISTORICAL_READ_ONLY", "Historical payments are read-only.")
    if p.state != "RELEASED":
        raise Conflict("INVALID_TRANSITION", f"Payment is {p.state}; only RELEASED payments settle.")
    if outcome not in {"SETTLED", "FAILED"}:
        raise Unprocessable("OUTCOME_INVALID", "outcome must be SETTLED or FAILED.")
    inv = session.get(Invoice, p.invoice_id)
    assert inv is not None
    p.state = outcome
    if outcome == "SETTLED":
        p.settled_at = utcnow()
    lc.transition(session, inv, lc.SETTLED if outcome == "SETTLED" else lc.FAILED, actor=actor,
                  reason=f"simulated settlement outcome {outcome}")
    audit.record(session, actor=actor, action=f"payment.simulated_{outcome.lower()}", object_type="payment",
                 object_id=p.id, object_version=p.invoice_version, invoice_id=inv.id, before="RELEASED", after=outcome,
                 details={"simulation": True, "note": "Settlement is simulated; no funds moved."})
    return p
