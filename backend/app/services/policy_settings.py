"""Editable approval policy (brief: "Let an admin edit the rules").

A controller/admin can change the approval thresholds (P01-P04), the finance manager's release cap
(P09/P10) and switch the extra finance-manager step for new/pending (P05) and legal (P06) suppliers.
Changes may only make the policy stricter than each role's authority limit (approval_policy.
validate_policy). Separation-of-duties rules (P07, P11), PO controls (P12, P13) and hard holds are not
editable. Every change is versioned and audited with before/after values, and open invoices that
nobody has approved yet are re-routed under the new rules; partly approved invoices keep their chain."""
from __future__ import annotations

from dataclasses import fields
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Unprocessable
from app.core.permissions import require
from app.db.models import ApprovalDecision, Invoice, PolicySetting, User, utcnow
from app.services import audit
from app.services.approval_policy import (
    DEFAULT_POLICY,
    POLICY_MAXIMUMS,
    POLICY_MINIMUM_MINOR,
    PolicyConfig,
    validate_policy,
)

POLICY_ID = "approval"
_FIELDS = {f.name for f in fields(PolicyConfig)}


def _row(session: Session) -> PolicySetting | None:
    return session.get(PolicySetting, POLICY_ID)


def current(session: Session) -> PolicyConfig:
    """The policy in force. Falls back to the dataset defaults when nobody has edited it."""
    row = _row(session)
    if row is None or not row.values:
        return DEFAULT_POLICY
    values = {k: v for k, v in row.values.items() if k in _FIELDS}
    return PolicyConfig(**{**DEFAULT_POLICY.to_dict(), **values})


def _cad(minor: int) -> str:
    return f"CAD {minor / 100:,.0f}" if minor % 100 == 0 else f"CAD {minor / 100:,.2f}"


def rules(cfg: PolicyConfig) -> list[dict[str, Any]]:
    """P01-P13 in plain words, reflecting the current values, with what may be edited."""
    d, c, f, r = cfg.dept_manager_up_to_minor, cfg.controller_over_minor, cfg.cfo_over_minor, cfg.fm_release_up_to_minor
    locked = "locked"
    return [
        {"id": "P01", "text": f"Invoices up to {_cad(d)} need the department manager.", "editable": "threshold"},
        {"id": "P02", "text": f"Above {_cad(d)}, the finance manager approves too.", "editable": "threshold"},
        {"id": "P03", "text": f"Above {_cad(c)}, the controller approves too.", "editable": "threshold"},
        {"id": "P04", "text": f"Above {_cad(f)}, the CFO approves too.", "editable": "threshold"},
        {"id": "P05", "text": "New or pending suppliers need the finance manager."
         if cfg.new_vendor_needs_fm else "New or pending suppliers: no extra finance-manager step (turned off).",
         "editable": "switch"},
        {"id": "P06", "text": "Legal suppliers need the finance manager."
         if cfg.legal_vendor_needs_fm else "Legal suppliers: no extra finance-manager step (turned off).",
         "editable": "switch"},
        {"id": "P07", "text": "Nobody approves their own invoice; it goes to their manager.", "editable": locked},
        {"id": "P08", "text": "When an approver is away, their delegate approves for them.",
         "editable": "delegation"},
        {"id": "P09", "text": f"The finance manager can release payments up to {_cad(r)}.", "editable": "threshold"},
        {"id": "P10", "text": f"Above {_cad(r)}, only the controller can release.", "editable": "threshold"},
        {"id": "P11", "text": "Whoever approved an invoice can't release its payment.", "editable": locked},
        {"id": "P12", "text": "Invoices over a purchase order's remaining balance need the finance manager.",
         "editable": locked},
        {"id": "P13", "text": "Suppliers that require a purchase order are held without one.", "editable": locked},
    ]


def describe(session: Session) -> dict[str, Any]:
    row = _row(session)
    cfg = current(session)
    return {
        "version": row.version if row else 0,
        "values": cfg.to_dict(),
        "defaults": DEFAULT_POLICY.to_dict(),
        "maximums": dict(POLICY_MAXIMUMS),
        "minimum_minor": POLICY_MINIMUM_MINOR,
        "rules": rules(cfg),
        "updated_by": row.updated_by if row else None,
        "updated_at": row.updated_at if row else None,
        "reason": row.reason if row else None,
    }


def _open_unapproved_invoices(session: Session) -> list[Invoice]:
    """Invoices waiting for approval on which nobody has approved anything yet."""
    from app.services import lifecycle as lc

    out = []
    for inv in session.scalars(select(Invoice).where(Invoice.lifecycle_state == lc.PENDING_APPROVAL,
                                                     Invoice.source_kind != "historical_ledger")
                               .order_by(Invoice.id)):
        decided = session.scalar(select(ApprovalDecision.id).where(ApprovalDecision.invoice_id == inv.id,
                                                                   ApprovalDecision.version == inv.current_version))
        if decided is None:
            out.append(inv)
    return out


def update(session: Session, actor: User, *, expected_version: int, values: dict[str, Any],
           reason: str) -> dict[str, Any]:
    require(actor, "policy.edit")
    row = _row(session)
    version = row.version if row else 0
    if expected_version != version:
        raise Conflict("POLICY_VERSION_CONFLICT", "Someone changed the approval rules. Refresh and try again.",
                       {"expected_version": expected_version, "current_version": version})
    if not reason or len(reason.strip()) < 5:
        raise Unprocessable("REASON_REQUIRED", "Say why the rules are changing (at least 5 characters).")
    unknown = sorted(set(values) - _FIELDS)
    if unknown:
        raise Unprocessable("POLICY_FIELD_UNKNOWN", f"Unknown policy settings: {', '.join(unknown)}.")
    before = current(session)
    proposed = PolicyConfig(**{**before.to_dict(), **values})
    errors = validate_policy(proposed)
    if errors:
        raise Unprocessable("POLICY_INVALID", errors[0], {"errors": errors})
    changed = {k: {"before": getattr(before, k), "after": getattr(proposed, k)}
               for k in _FIELDS if getattr(before, k) != getattr(proposed, k)}
    if not changed:
        return {**describe(session), "rerouted_invoice_ids": [], "changed": {}}
    if row is None:
        row = PolicySetting(id=POLICY_ID, values={}, version=0)
        session.add(row)
    row.values = proposed.to_dict()
    row.version = version + 1
    row.updated_by = actor.id
    row.updated_at = utcnow()
    row.reason = reason.strip()
    session.flush()
    audit.record(session, actor=actor, action="policy.updated", object_type="approval_policy", object_id=POLICY_ID,
                 object_version=row.version, details={"changed": changed, "reason": row.reason})
    # Re-route invoices nobody has approved yet so they follow the new rules now.
    from app.services import pipeline

    rerouted = []
    for inv in _open_unapproved_invoices(session):
        pipeline.process(session, inv, actor=actor, reason=f"approval rules changed (policy v{row.version})")
        rerouted.append(inv.id)
    return {**describe(session), "rerouted_invoice_ids": rerouted, "changed": changed}
