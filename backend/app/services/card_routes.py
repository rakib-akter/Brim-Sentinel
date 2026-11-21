"""Verified virtual-card rerouting (PRD §6.2, wizard step 3) — SIMULATED.

Two separate controls:

1. **Card-route registry** (per vendor). A human registers a CARD route with a merchant
   reference they obtained from the supplier (never inferred from a card descriptor). It starts
   UNVERIFIED. A *different* person verifies it by an independent callback to a trusted contact
   that was on file before the registration; only then is it VERIFIED. Card history is recorded
   as supporting evidence only.

2. **Payment-method change** (per invoice version). Request EFT → CARD; a **finance manager**
   who is neither the requester, the route registrant nor the route verifier authorizes or
   declines it. An authorized change applies only to the invoice version it was bound to. It
   lets that version be paid through the verified card route instead of the (possibly
   unverified) EFT destination; EFT to a changed account stays blocked. It never approves the
   invoice or releases money: approvals and an independent releaser are still required, and the
   method-change requester/authorizer cannot release that payment.

AI/service identities cannot perform any of these steps (`permissions.require`)."""
from __future__ import annotations

import datetime as dt
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.core.permissions import require
from app.db.models import (
    CardTransaction,
    Invoice,
    PaymentMethodChange,
    PaymentRoute,
    User,
    Vendor,
    VendorContact,
    utcnow,
)
from app.services import audit, lifecycle as lc, pipeline
from app.services import vendors as vendor_svc

VERIFY_METHODS = {"phone_callback_to_contact_on_file", "video_call_to_contact_on_file", "in_person_meeting"}
REQUESTABLE_STATES = {lc.ON_HOLD, lc.PENDING_APPROVAL, lc.APPROVED}
CARD_HISTORY_DAYS = 180


# ----------------------------------------------------------------------------- lookups
def get_route(session: Session, route_id: str) -> PaymentRoute:
    r = session.get(PaymentRoute, route_id)
    if r is None or r.method != "CARD":
        raise NotFound("CARD_ROUTE_NOT_FOUND", f"Card route {route_id} not found.")
    return r


def get_change(session: Session, change_id: str) -> PaymentMethodChange:
    c = session.get(PaymentMethodChange, change_id)
    if c is None:
        raise NotFound("METHOD_CHANGE_NOT_FOUND", f"Payment-method change {change_id} not found.")
    return c


def verified_card_route(session: Session, vendor_id: str | None) -> PaymentRoute | None:
    if not vendor_id:
        return None
    return session.scalar(select(PaymentRoute).where(PaymentRoute.vendor_id == vendor_id,
                                                     PaymentRoute.method == "CARD",
                                                     PaymentRoute.status == "VERIFIED").order_by(PaymentRoute.id))


def active_change(session: Session, invoice_id: str, version: int) -> PaymentMethodChange | None:
    """The AUTHORIZED method change bound to exactly this invoice version, if any."""
    return session.scalar(select(PaymentMethodChange).where(
        PaymentMethodChange.invoice_id == invoice_id, PaymentMethodChange.invoice_version == version,
        PaymentMethodChange.state == "AUTHORIZED"))


def changes_for(session: Session, invoice_id: str) -> list[PaymentMethodChange]:
    return list(session.scalars(select(PaymentMethodChange).where(PaymentMethodChange.invoice_id == invoice_id)
                                .order_by(PaymentMethodChange.requested_at)))


def card_history(session: Session, vendor: Vendor) -> dict[str, Any]:
    """Recent Brim card charges (AP virtual or employee cards) whose descriptor resembles the vendor. Supporting
    evidence only — a descriptor never proves merchant ownership."""
    as_of = get_settings().as_of_date
    since = (dt.date.fromisoformat(as_of) - dt.timedelta(days=CARD_HISTORY_DAYS)).isoformat()
    nn = vendor_svc.normalize_name(vendor.legal_name).upper()
    hits = []
    for tx in session.scalars(select(CardTransaction).where(CardTransaction.posted_date >= since,
                                                            CardTransaction.posted_date <= as_of)):
        desc = vendor_svc.normalize_name(tx.merchant_descriptor).upper()
        score = max(fuzz.partial_ratio(desc, nn), fuzz.token_set_ratio(desc, nn))
        if score >= 85:
            hits.append({"txn_id": tx.id, "posted_date": tx.posted_date, "descriptor": tx.merchant_descriptor,
                         "source": tx.source,
                         "amount_cad_minor": tx.amount_cad_minor, "descriptor_score": round(score)})
    hits.sort(key=lambda h: h["posted_date"])
    return {"window_days": CARD_HISTORY_DAYS, "as_of": as_of, "matches": len(hits),
            "last_posted_date": hits[-1]["posted_date"] if hits else None, "transactions": hits[-5:],
            "note": "Supporting evidence only: card history never establishes merchant ownership."}


# ----------------------------------------------------------------------------- route registry
def register_card_route(session: Session, actor: User, vendor: Vendor, *, merchant_reference: str,
                        evidence_ref: str, notes: str) -> PaymentRoute:
    require(actor, "card_route.register")
    if vendor.status != "active":
        raise Unprocessable("VENDOR_NOT_ACTIVE", f"Vendor {vendor.id} is {vendor.status}.")
    if not vendor.accepts_card_payment:
        raise Unprocessable("VENDOR_DOES_NOT_ACCEPT_CARD", "The vendor master does not confirm card acceptance; "
                            "no card route can be registered.")
    ref = (merchant_reference or "").strip()
    if not (4 <= len(ref) <= 64) or not all(ch.isalnum() or ch in "-_" for ch in ref):
        raise Unprocessable("MERCHANT_REFERENCE_INVALID", "Merchant reference must be 4–64 letters, digits, '-' "
                            "or '_' as supplied by the vendor (never derived from a card descriptor).")
    if not evidence_ref or len(evidence_ref.strip()) < 3:
        raise Unprocessable("EVIDENCE_REQUIRED", "An evidence reference (e.g. the vendor's written instruction) is "
                            "required.")
    if not notes or len(notes.strip()) < 10:
        raise Unprocessable("NOTES_REQUIRED", "Describe where the merchant reference came from (≥ 10 characters).")
    n = (session.scalar(select(func.count()).select_from(PaymentRoute).where(
        PaymentRoute.vendor_id == vendor.id, PaymentRoute.method == "CARD")) or 0) + 1
    route = PaymentRoute(
        id=f"RT-{vendor.id}-CARD-APP-{n:02d}", vendor_id=vendor.id, method="CARD", account_last4=ref[-4:],
        account_fingerprint=None, status="UNVERIFIED",
        provenance=f"SIMULATED Brim virtual-card route registered by {actor.id} (merchant ref ****{ref[-4:]}, "
                   f"evidence {evidence_ref}); awaiting independent verification",
        verified_at=None, bank_change_id=None, merchant_reference=ref, registered_by=actor.id,
        registered_at=_today())
    session.add(route)
    session.flush()
    audit.record(session, actor=actor, action="card_route.registered", object_type="payment_route",
                 object_id=route.id, after="UNVERIFIED", evidence=[{"type": "route_evidence", "ref": evidence_ref}],
                 details={"vendor_id": vendor.id, "merchant_ref_last4": ref[-4:], "notes": notes,
                          "card_history": card_history(session, vendor)})
    return route


def _today() -> str:
    return dt.date.today().isoformat()


def trusted_contacts(session: Session, route: PaymentRoute) -> list[VendorContact]:
    cutoff = route.registered_at or "0000-00-00"
    return [c for c in session.scalars(select(VendorContact).where(VendorContact.vendor_id == route.vendor_id))
            if c.source == "vendor_master" and c.established_at < cutoff]


def verify_card_route(session: Session, actor: User, route: PaymentRoute, *, trusted_contact_id: str | None,
                      method: str, occurred_at: str, outcome: str, notes: str, evidence_ref: str,
                      expected_row_version: int | None) -> PaymentRoute:
    require(actor, "card_route.verify")
    if expected_row_version is not None and expected_row_version != route.row_version:
        raise Conflict("CARD_ROUTE_VERSION_CONFLICT", "This card route was updated. Refresh before continuing.",
                       {"expected": expected_row_version, "current": route.row_version})
    if route.status != "UNVERIFIED" or route.registered_by is None:
        raise Conflict("INVALID_TRANSITION", f"Card route {route.id} is {route.status}; only app-registered "
                       "UNVERIFIED routes can be verified here.")
    if actor.id == route.registered_by:
        raise Forbidden("VERIFIER_NOT_INDEPENDENT", "The person who registered the card route cannot verify it.")
    contacts = {c.id: c for c in trusted_contacts(session, route)}
    if not contacts:
        raise Unprocessable("TRUSTED_CONTACT_MISSING", "No trusted contact was on file before the route was "
                            "registered. The card route stays unverified.")
    if trusted_contact_id not in contacts:
        raise Unprocessable("TRUSTED_CONTACT_INVALID", "Verification must use a contact on file before the route "
                            "was registered.", {"trusted_contact_ids": sorted(contacts)})
    if method not in VERIFY_METHODS:
        raise Unprocessable("VERIFICATION_METHOD_INVALID", "Unsupported verification method.",
                            {"allowed": sorted(VERIFY_METHODS)})
    if outcome not in {"CONFIRMED", "DENIED"}:
        raise Unprocessable("OUTCOME_INVALID", "outcome must be CONFIRMED or DENIED.")
    if not evidence_ref or len(evidence_ref.strip()) < 3:
        raise Unprocessable("EVIDENCE_REQUIRED", "An evidence reference (e.g. call log ID) is required.")
    if not notes or len(notes.strip()) < 10:
        raise Unprocessable("NOTES_REQUIRED", "Describe what the supplier confirmed (≥ 10 characters).")
    try:
        when = dt.datetime.fromisoformat(occurred_at)
    except ValueError as e:
        raise Unprocessable("OCCURRED_AT_INVALID", "occurred_at must be an ISO datetime.") from e
    if route.registered_at and when.date().isoformat() < route.registered_at:
        raise Unprocessable("OCCURRED_AT_INVALID", "Verification cannot pre-date the route registration.")
    route.verified_by = actor.id
    route.verification = {"trusted_contact_id": trusted_contact_id, "method": method, "occurred_at": occurred_at,
                          "outcome": outcome, "notes": notes, "evidence_ref": evidence_ref,
                          "contact_established_at": contacts[trusted_contact_id].established_at}
    old = route.status
    route.row_version += 1
    if outcome == "DENIED":
        route.status = "REVOKED"
        route.provenance += f"; supplier DENIED on callback by {actor.id}"
    else:
        route.status = "VERIFIED"
        route.verified_at = occurred_at
        route.provenance = (f"SIMULATED Brim virtual-card route; merchant ref ****{route.account_last4} registered "
                            f"by {route.registered_by}; independently verified by {actor.id} via {method} to trusted "
                            f"contact {trusted_contact_id} at {occurred_at} (evidence {evidence_ref})")
    audit.record(session, actor=actor, action="card_route.verification_recorded", object_type="payment_route",
                 object_id=route.id, before=old, after=route.status,
                 evidence=[{"type": "verification_evidence", "ref": evidence_ref},
                           {"type": "vendor_contact", "ref": trusted_contact_id}],
                 details={k: v for k, v in route.verification.items() if k != "notes"} | {"notes": notes})
    return route


# ----------------------------------------------------------------------------- method change
def request_change(session: Session, actor: User, inv: Invoice, *, expected_version: int, to_method: str,
                   reason: str) -> PaymentMethodChange:
    require(actor, "payment_method.request")
    if inv.source_kind == "historical_ledger":
        raise Conflict("HISTORICAL_READ_ONLY", "Historical ledger records are read-only.")
    if expected_version != inv.current_version:
        raise Conflict("INVOICE_VERSION_CONFLICT", "This invoice changed. Refresh before continuing.",
                       {"expected_version": expected_version, "current_version": inv.current_version})
    if to_method != "CARD":
        raise Unprocessable("METHOD_INVALID", "Only EFT → CARD (simulated Brim virtual card) changes are supported.")
    if not reason or len(reason.strip()) < 10:
        raise Unprocessable("REASON_REQUIRED", "Explain why the method should change (≥ 10 characters).")
    v = pipeline.current_version(session, inv)
    vendor = session.get(Vendor, inv.vendor_id) if inv.vendor_id else None
    from_method = (v.remit or {}).get("method") or "EFT"
    gates: list[str] = []
    if inv.kind != "invoice" or (v.total_minor or 0) <= 0:
        gates.append("CREDIT_NOTE_NOT_PAYABLE")
    if inv.lifecycle_state not in REQUESTABLE_STATES:
        gates.append(f"INVOICE_STATE_{inv.lifecycle_state}")
    if from_method == "CARD":
        gates.append("ALREADY_CARD")
    if vendor is None or vendor.status != "active":
        gates.append("VENDOR_NOT_ACTIVE")
    elif not vendor.accepts_card_payment:
        gates.append("VENDOR_DOES_NOT_ACCEPT_CARD")
    route = verified_card_route(session, inv.vendor_id)
    if route is None:
        gates.append("VERIFIED_CARD_ROUTE_UNAVAILABLE")
    pending = session.scalar(select(PaymentMethodChange).where(
        PaymentMethodChange.invoice_id == inv.id, PaymentMethodChange.invoice_version == v.version,
        PaymentMethodChange.state.in_({"REQUESTED", "AUTHORIZED"})))
    if pending is not None:
        raise Conflict("METHOD_CHANGE_EXISTS", f"{pending.id} is already {pending.state} for this version.",
                       {"method_change_id": pending.id})
    if gates:
        raise Unprocessable("METHOD_CHANGE_GATES_UNMET", "A card payment cannot be proposed; the invoice stays on its "
                            "current route and any hold remains.", {"failed_gates": gates})
    assert vendor is not None and route is not None
    n = (session.scalar(select(func.count()).select_from(PaymentMethodChange).where(
        PaymentMethodChange.invoice_id == inv.id)) or 0) + 1
    pmc = PaymentMethodChange(
        id=f"PMC-{inv.id}-v{v.version}-{n:02d}", invoice_id=inv.id, invoice_version=v.version, vendor_id=vendor.id,
        from_method=from_method, to_method="CARD", route_id=route.id, state="REQUESTED", requested_by=actor.id,
        reason=reason,
        gate_snapshot={"vendor_accepts_card": True, "route_id": route.id, "route_status": route.status,
                       "route_provenance": route.provenance, "route_verified_at": route.verified_at,
                       "route_verified_by": route.verified_by, "invoice_state": inv.lifecycle_state,
                       "blocking_codes": sorted({f.code for f in pipeline.blocking_findings(session, inv.id,
                                                                                            v.version)})},
        supporting_card_history=card_history(session, vendor))
    session.add(pmc)
    session.flush()
    audit.record(session, actor=actor, action="payment_method.change_requested", object_type="payment_method_change",
                 object_id=pmc.id, object_version=v.version, invoice_id=inv.id, after="REQUESTED",
                 evidence=[{"type": "payment_route", "ref": route.id, "provenance": route.provenance}],
                 details={"from": from_method, "to": "CARD", "reason": reason,
                          "note": "A request is not an authorization, approval or release."})
    inv.row_version += 1
    return pmc


def decide_change(session: Session, actor: User, pmc: PaymentMethodChange, *, decision: str, notes: str,
                  expected_row_version: int | None) -> PaymentMethodChange:
    require(actor, "payment_method.authorize")
    if expected_row_version is not None and expected_row_version != pmc.row_version:
        raise Conflict("METHOD_CHANGE_VERSION_CONFLICT", "This request was updated. Refresh before continuing.",
                       {"expected": expected_row_version, "current": pmc.row_version})
    if pmc.state != "REQUESTED":
        raise Conflict("INVALID_TRANSITION", f"{pmc.id} is {pmc.state}.")
    if decision not in {"AUTHORIZED", "DECLINED"}:
        raise Unprocessable("DECISION_INVALID", "decision must be AUTHORIZED or DECLINED.")
    if not notes or len(notes.strip()) < 10:
        raise Unprocessable("NOTES_REQUIRED", "Document the checks performed (≥ 10 characters).")
    inv = session.get(Invoice, pmc.invoice_id)
    assert inv is not None
    route = session.get(PaymentRoute, pmc.route_id)
    v = pipeline.current_version(session, inv)
    conflicts = {pmc.requested_by: "METHOD_CHANGE_SELF_AUTHORIZATION",
                 v.requester_id: "REQUESTER_CANNOT_AUTHORIZE_METHOD_CHANGE"}
    if route is not None:
        conflicts.update({route.registered_by: "ROUTE_REGISTRANT_CANNOT_AUTHORIZE",
                          route.verified_by: "ROUTE_VERIFIER_CANNOT_AUTHORIZE"})
    code = conflicts.get(actor.id)
    if code:
        raise Forbidden(code, "Segregation of duties: the method change must be authorized by a finance manager "
                        "independent of the requester, the invoice requester and the card-route registrant/verifier.")
    if decision == "AUTHORIZED":
        failed = []
        if pmc.invoice_version != inv.current_version:
            failed.append("INVOICE_VERSION_CHANGED")
        if route is None or route.status != "VERIFIED":
            failed.append("CARD_ROUTE_NOT_VERIFIED")
        vendor = session.get(Vendor, pmc.vendor_id)
        if vendor is None or not vendor.accepts_card_payment or vendor.status != "active":
            failed.append("VENDOR_CARD_ACCEPTANCE_UNCONFIRMED")
        if inv.lifecycle_state not in REQUESTABLE_STATES:
            failed.append(f"INVOICE_STATE_{inv.lifecycle_state}")
        if failed:
            raise Unprocessable("METHOD_CHANGE_GATES_UNMET", "Gates changed since the request; it cannot be "
                                "authorized.", {"failed_gates": failed})
    pmc.state = decision
    pmc.decided_by = actor.id
    pmc.decided_at = utcnow()
    pmc.decision_notes = notes
    pmc.row_version += 1
    audit.record(session, actor=actor, action=f"payment_method.change_{decision.lower()}",
                 object_type="payment_method_change", object_id=pmc.id, object_version=pmc.invoice_version,
                 invoice_id=inv.id, before="REQUESTED", after=decision,
                 evidence=[{"type": "payment_route", "ref": pmc.route_id}], policy_ids=[],
                 details={"notes": notes, "requested_by": pmc.requested_by,
                          "note": "Authorizing a method change is not an approval or a release."})
    if decision == "AUTHORIZED" and inv.lifecycle_state in lc.REVALIDATABLE:
        pipeline.process(session, inv, actor=actor, reason=f"payment method change {pmc.id} authorized")
    inv.row_version += 1
    return pmc


def supersede_for_new_version(session: Session, inv: Invoice, actor: User | None, new_version: int) -> None:
    for pmc in session.scalars(select(PaymentMethodChange).where(
            PaymentMethodChange.invoice_id == inv.id, PaymentMethodChange.invoice_version < new_version,
            PaymentMethodChange.state.in_({"REQUESTED", "AUTHORIZED"}))):
        old = pmc.state
        pmc.state = "SUPERSEDED"
        pmc.row_version += 1
        audit.record(session, actor=actor, action="payment_method.change_superseded",
                     object_type="payment_method_change", object_id=pmc.id, invoice_id=inv.id, before=old,
                     after="SUPERSEDED", details={"reason": f"invoice version {new_version} created; a method "
                                                            f"change applies only to the version it was bound to"})
