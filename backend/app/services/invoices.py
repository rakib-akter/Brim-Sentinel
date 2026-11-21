"""Invoice commands: material edits (new immutable version, approvals invalidated), coding
decisions, finding dismissals, revalidation and cancellation. Every command checks
expected_version (409 on mismatch) and server-side permissions."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.core.money import to_minor
from app.core.permissions import require
from app.db.models import (
    ApprovalDecision,
    Department,
    FindingDismissal,
    GLAccount,
    Invoice,
    InvoiceLine,
    InvoiceVersion,
    PurchaseOrder,
    User,
    Vendor,
)
from app.services import audit, catalog, extraction, lifecycle as lc, pipeline

EDITABLE_FIELDS = {"vendor_id", "invoice_number", "invoice_date", "due_date", "currency", "subtotal", "total",
                   "taxes", "po_number", "department_id", "requester_id", "ship_to_province", "terms", "lines"}


def get_invoice(session: Session, invoice_id: str) -> Invoice:
    inv = session.get(Invoice, invoice_id)
    if inv is None:
        raise NotFound("INVOICE_NOT_FOUND", f"Invoice {invoice_id} not found.")
    return inv


def _check_version(inv: Invoice, expected_version: int) -> None:
    if expected_version != inv.current_version:
        raise Conflict("INVOICE_VERSION_CONFLICT", "This invoice changed. Refresh before continuing.",
                       {"expected_version": expected_version, "current_version": inv.current_version})


def _check_workflow_invoice(inv: Invoice) -> None:
    if inv.source_kind == "historical_ledger":
        raise Conflict("HISTORICAL_READ_ONLY", "Historical ledger records are read-only reference data.")


def new_version(session: Session, inv: Invoice, actor: User, *, reason: str, changes: dict[str, Any],
                line_changes: list[dict[str, Any]] | None = None, line_coding: dict[int, dict[str, Any]] | None = None
                ) -> InvoiceVersion:
    """Copy the current version, apply changes, bump version. Prior approvals no longer apply
    (they are bound to the old version) and any scheduled payment is cancelled."""
    old = pipeline.current_version(session, inv)
    cols = {c.key for c in InvoiceVersion.__table__.columns} - {"id", "version", "created_at", "created_by", "reason",
                                                                  "provenance"}
    data = {c: getattr(old, c) for c in cols}
    data.update(changes)
    nv = InvoiceVersion(**data, version=old.version + 1, created_by=actor.id, reason=reason, provenance="manual")
    session.add(nv)
    old_lines = pipeline.version_lines(session, inv.id, old.version)
    if line_changes is not None:
        for i, ln in enumerate(line_changes, start=1):
            session.add(InvoiceLine(invoice_id=inv.id, version=nv.version, line_no=i, description=ln["description"],
                                    quantity=str(ln.get("quantity", "1")),
                                    unit_price_minor=ln.get("unit_price_minor"), amount_minor=ln.get("amount_minor")))
    else:
        for ln in old_lines:
            lc_ = (line_coding or {}).get(ln.line_no)
            session.add(InvoiceLine(
                invoice_id=inv.id, version=nv.version, line_no=ln.line_no, description=ln.description,
                quantity=ln.quantity, unit_price_minor=ln.unit_price_minor, amount_minor=ln.amount_minor,
                line_type=ln.line_type,
                gl_account=lc_["gl_account"] if lc_ else ln.gl_account,
                department_id=lc_["department_id"] if lc_ else ln.department_id,
                coding_confidence=ln.coding_confidence, coding_method=ln.coding_method,
                coding_status="OVERRIDDEN" if lc_ else ("CONFIRMED" if ln.coding_status in {"CONFIRMED", "OVERRIDDEN"} else None),
                coding_detail={**(ln.coding_detail or {}), **({"override_reason": lc_["reason"], "override_by": actor.id}
                                                               if lc_ else {})}))
    prior = list(session.scalars(select(ApprovalDecision).where(ApprovalDecision.invoice_id == inv.id,
                                                                ApprovalDecision.version == old.version)))
    inv.current_version = nv.version
    inv.row_version += 1
    session.flush()
    pipeline.cancel_scheduled_payments(session, inv, actor, f"material edit created version {nv.version}")
    from app.services import card_routes
    card_routes.supersede_for_new_version(session, inv, actor, nv.version)
    audit.record(session, actor=actor, action="invoice.version_created", object_type="invoice", object_id=inv.id,
                 object_version=nv.version, before=f"v{old.version}", after=f"v{nv.version}",
                 details={"reason": reason, "changed_fields": sorted(changes.keys()) + (["lines"] if line_changes else [])
                          + (["coding"] if line_coding else []),
                          "approvals_invalidated": [{"step": d.step_key, "actor": d.actor_id} for d in prior]})
    if prior:
        audit.record(session, actor=actor, action="approvals.invalidated", object_type="invoice", object_id=inv.id,
                     object_version=old.version, result="INFO",
                     details={"reason": f"material change → version {nv.version}",
                              "decisions": [d.id for d in prior]})
    return nv


def edit_fields(session: Session, actor: User, inv: Invoice, *, expected_version: int, reason: str,
                fields: dict[str, Any]) -> Invoice:
    require(actor, "invoice.edit")
    _check_workflow_invoice(inv)
    _check_version(inv, expected_version)
    if inv.lifecycle_state not in lc.PRE_PAYMENT_EDITABLE:
        raise Conflict("INVALID_TRANSITION", f"Invoice in state {inv.lifecycle_state} cannot be edited.")
    unknown = set(fields) - EDITABLE_FIELDS
    if unknown:
        raise Unprocessable("FIELD_NOT_EDITABLE", f"Fields not editable: {sorted(unknown)}",
                            {"editable": sorted(EDITABLE_FIELDS)})
    if not reason or len(reason.strip()) < 5:
        raise Unprocessable("REASON_REQUIRED", "A reason (≥ 5 characters) is required for any edit.")
    changes: dict[str, Any] = {}
    old = pipeline.current_version(session, inv)
    uncertain = set(old.uncertain_fields or [])
    for k, val in fields.items():
        if k == "vendor_id":
            if val is not None and session.get(Vendor, val) is None:
                raise Unprocessable("VENDOR_NOT_FOUND", f"Vendor {val} does not exist.")
            changes["vendor_id"] = val
            changes["vendor_match"] = {"vendor_id": val, "method": "manual", "by": actor.id}
        elif k == "invoice_number":
            changes["invoice_number_raw"] = val
            changes["invoice_number_norm"] = extraction.normalize_invoice_number(val)
        elif k in {"invoice_date", "due_date"}:
            if val is not None:
                import datetime as dt
                try:
                    dt.date.fromisoformat(val)
                except ValueError as e:
                    raise Unprocessable("DATE_INVALID", f"{k} must be YYYY-MM-DD.") from e
            changes[k] = val
        elif k == "currency":
            if val not in {"CAD", "USD"}:
                raise Unprocessable("CURRENCY_INVALID", "currency must be CAD or USD.")
            changes["currency"] = val
        elif k in {"subtotal", "total"}:
            changes[f"{k}_minor"] = to_minor(str(val)) if val is not None else None
        elif k == "taxes":
            changes["taxes"] = [{"label": t["label"], "kind": t["kind"].upper(), "rate_pct": t.get("rate_pct"),
                                 "amount_minor": to_minor(str(t["amount"]))} for t in val]
        elif k == "po_number":
            if val and session.get(PurchaseOrder, val) is None:
                raise Unprocessable("PO_NOT_FOUND", f"PO {val} does not exist.")
            changes["po_number"] = val or None
        elif k == "department_id":
            if session.get(Department, val) is None:
                raise Unprocessable("DEPARTMENT_NOT_FOUND", f"Department {val} does not exist.")
            changes["department_id"], changes["department_source"] = val, f"manual:{actor.id}"
        elif k == "requester_id":
            if session.get(User, val) is None:
                raise Unprocessable("USER_NOT_FOUND", f"User {val} does not exist.")
            changes["requester_id"], changes["requester_source"] = val, f"manual:{actor.id}"
        elif k == "ship_to_province":
            changes["ship_to_province"] = val
        elif k == "terms":
            changes["terms_raw"] = val
        uncertain.discard({"subtotal": "subtotal", "total": "total"}.get(k, k))
    line_changes = None
    if "lines" in fields:
        line_changes = [{"description": ln["description"], "quantity": str(ln.get("quantity", "1")),
                         "unit_price_minor": to_minor(str(ln["unit_price"])), "amount_minor": to_minor(str(ln["amount"]))}
                        for ln in fields["lines"]]
        uncertain = {u for u in uncertain if not u.startswith("lines")}
    if {"invoice_number", "total", "currency", "invoice_date", "lines"} & set(fields):
        uncertain.discard("document")
    changes["uncertain_fields"] = sorted(uncertain)
    new_version(session, inv, actor, reason=reason, changes=changes, line_changes=line_changes)
    if inv.lifecycle_state == lc.SCHEDULED:
        lc.transition(session, inv, lc.ON_HOLD, actor=actor, reason="scheduled payment cancelled by material edit")
    pipeline.process(session, inv, actor=actor, reason=f"revalidation after edit: {reason}")
    return inv


def coding_decision(session: Session, actor: User, inv: Invoice, *, expected_version: int,
                    lines: list[dict[str, Any]]) -> Invoice:
    require(actor, "invoice.coding_decision")
    _check_workflow_invoice(inv)
    _check_version(inv, expected_version)
    if inv.lifecycle_state not in lc.PRE_PAYMENT_EDITABLE - {lc.REJECTED}:
        raise Conflict("INVALID_TRANSITION", f"Invoice in state {inv.lifecycle_state} cannot be recoded.")
    v = pipeline.current_version(session, inv)
    current = {ln.line_no: ln for ln in pipeline.version_lines(session, inv.id, v.version)}
    overrides: dict[int, dict[str, Any]] = {}
    accepted: list[int] = []
    for item in lines:
        ln = current.get(item["line_no"])
        if ln is None:
            raise Unprocessable("LINE_NOT_FOUND", f"Line {item['line_no']} not on version {v.version}.")
        gl = item.get("gl_account") or ln.gl_account
        dept = item.get("department_id") or ln.department_id or v.department_id
        if gl is None or session.get(GLAccount, gl) is None:
            raise Unprocessable("GL_NOT_FOUND", f"GL account {gl} does not exist.")
        if dept is None or session.get(Department, dept) is None:
            raise Unprocessable("DEPARTMENT_NOT_FOUND", f"Department {dept} does not exist.")
        if gl != ln.gl_account or dept != ln.department_id:
            if not item.get("reason") or len(item["reason"].strip()) < 5:
                raise Unprocessable("REASON_REQUIRED", "Overriding a coding suggestion requires a reason.")
            overrides[ln.line_no] = {"gl_account": gl, "department_id": dept, "reason": item["reason"]}
        else:
            accepted.append(ln.line_no)
    if overrides:
        # Relevant coding change is material: new version, approvals invalidated.
        new_version(session, inv, actor, reason="coding override", changes={}, line_coding=overrides)
        nv = pipeline.current_version(session, inv)
        for ln in pipeline.version_lines(session, inv.id, nv.version):
            if ln.line_no in accepted:
                ln.coding_status = "CONFIRMED"
        if inv.lifecycle_state == lc.SCHEDULED:
            lc.transition(session, inv, lc.ON_HOLD, actor=actor, reason="coding changed after scheduling")
    else:
        for no in accepted:
            current[no].coding_status = "CONFIRMED"
            current[no].coding_detail = {**(current[no].coding_detail or {}), "confirmed_by": actor.id}
        v.coding_confirmed_by = actor.id
    audit.record(session, actor=actor, action="coding.decision", object_type="invoice", object_id=inv.id,
                 object_version=inv.current_version,
                 details={"accepted_lines": accepted, "overrides": {str(k): v_ for k, v_ in overrides.items()},
                          "note": "Corrections are logged; retraining uses approved corrections only."})
    session.flush()
    pipeline.process(session, inv, actor=actor, reason="revalidation after coding decision")
    return inv


def dismiss_finding(session: Session, actor: User, inv: Invoice, *, finding_id: str, expected_version: int,
                    reason: str) -> Invoice:
    require(actor, "finding.dismiss")
    _check_workflow_invoice(inv)
    _check_version(inv, expected_version)
    from app.db.models import ValidationFinding

    f = session.get(ValidationFinding, finding_id)
    if f is None or f.invoice_id != inv.id or f.version != inv.current_version:
        raise NotFound("FINDING_NOT_FOUND", f"Finding {finding_id} not found on the current version.")
    latest_ids = {x.id for x in pipeline.latest_findings(session, inv.id, inv.current_version)}
    if f.id not in latest_ids:
        raise Conflict("FINDING_STALE", "This finding is from an older validation run. Refresh.")
    meta = catalog.info(f.code)
    if not meta.dismissible:
        raise Forbidden("HARD_HOLD_NOT_DISMISSIBLE",
                        f"{f.code} is a hard hold. It clears only when the underlying condition is fixed and "
                        f"revalidation passes.", {"code": f.code})
    if not reason or len(reason.strip()) < 10:
        raise Unprocessable("REASON_REQUIRED", "A documented reason (≥ 10 characters) is required.")
    v = pipeline.current_version(session, inv)
    if f.code in {"DUPLICATE_VENDOR_IDENTITY", "DUPLICATE_INVOICE"} and actor.id == v.requester_id:
        raise Forbidden("SELF_DISMISSAL_DENIED", "The requester cannot dismiss findings on their own invoice.")
    subject = (f.data or {}).get("subject", "")
    session.add(FindingDismissal(invoice_id=inv.id, version=inv.current_version, code=f.code, subject=subject,
                                 actor_id=actor.id, reason=reason))
    audit.record(session, actor=actor, action="finding.dismissed", object_type="invoice", object_id=inv.id,
                 object_version=inv.current_version, evidence=[{"type": "finding", "ref": f.id}],
                 details={"code": f.code, "subject": subject, "reason": reason,
                          "note": "Dismissal cannot clear any other independent hold."})
    session.flush()
    pipeline.process(session, inv, actor=actor, reason=f"revalidation after dismissal of {f.code}")
    return inv


def revalidate(session: Session, actor: User, inv: Invoice, *, expected_version: int) -> Invoice:
    require(actor, "invoice.revalidate")
    _check_workflow_invoice(inv)
    _check_version(inv, expected_version)
    if inv.lifecycle_state not in lc.REVALIDATABLE:
        raise Conflict("INVALID_TRANSITION", f"Invoice in state {inv.lifecycle_state} cannot be revalidated.")
    pipeline.process(session, inv, actor=actor, reason="manual revalidation")
    return inv


def cancel(session: Session, actor: User, inv: Invoice, *, expected_version: int, reason: str) -> Invoice:
    require(actor, "finding.dismiss")  # finance authority cancels invoices (e.g. confirmed duplicates)
    _check_workflow_invoice(inv)
    _check_version(inv, expected_version)
    if inv.lifecycle_state != lc.ON_HOLD:
        raise Conflict("INVALID_TRANSITION", "Only invoices on hold can be cancelled.")
    if not reason or len(reason.strip()) < 10:
        raise Unprocessable("REASON_REQUIRED", "A documented reason (≥ 10 characters) is required.")
    lc.transition(session, inv, lc.CANCELLED, actor=actor, reason=reason)
    from app.db.models import ResolutionCase
    for c in session.scalars(select(ResolutionCase).where(ResolutionCase.invoice_id == inv.id,
                                                          ResolutionCase.state.not_in({"RESOLVED", "REJECTED", "CANCELLED"}))):
        c.state, c.closure_outcome = "CANCELLED", f"Invoice cancelled by {actor.id}: {reason}"
        c.row_version += 1
        audit.record(session, actor=actor, action="case.cancelled", object_type="case", object_id=c.id,
                     invoice_id=inv.id, after="CANCELLED", details={"reason": reason})
    return inv
