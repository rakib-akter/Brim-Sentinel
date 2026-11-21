"""Canonical invoice lifecycle state machine. Every transition goes through `transition()`;
anything not listed is rejected (409) and audited by the caller's error handler.

Deviation (documented): CREDIT_RECORDED is a terminal state for credit notes, which are never
payable or schedulable (PRD FR-04)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.db.models import Invoice, User
from app.services import audit

RECEIVED = "RECEIVED"
DRAFT = "DRAFT"
EXTRACTED = "EXTRACTED"
CODED = "CODED"
VALIDATED = "VALIDATED"
ON_HOLD = "ON_HOLD"
PENDING_APPROVAL = "PENDING_APPROVAL"
APPROVED = "APPROVED"
SCHEDULED = "SCHEDULED"
RELEASED = "RELEASED"
SETTLED = "SETTLED"
REJECTED = "REJECTED"
CANCELLED = "CANCELLED"
FAILED = "FAILED"
CREDIT_RECORDED = "CREDIT_RECORDED"

PRE_PAYMENT_EDITABLE = {DRAFT, EXTRACTED, CODED, VALIDATED, ON_HOLD, PENDING_APPROVAL, APPROVED, SCHEDULED, REJECTED}
REVALIDATABLE = {EXTRACTED, CODED, VALIDATED, ON_HOLD, PENDING_APPROVAL, APPROVED, SCHEDULED}

TRANSITIONS: dict[str, set[str]] = {
    RECEIVED: {DRAFT},
    DRAFT: {EXTRACTED, ON_HOLD, CANCELLED},
    # Material edit or revalidation re-enters the pipeline at EXTRACTED.
    EXTRACTED: {CODED, ON_HOLD},
    CODED: {VALIDATED},
    VALIDATED: {ON_HOLD, PENDING_APPROVAL, APPROVED, CREDIT_RECORDED},
    ON_HOLD: {EXTRACTED, CANCELLED, REJECTED},
    PENDING_APPROVAL: {APPROVED, REJECTED, EXTRACTED, ON_HOLD},
    APPROVED: {SCHEDULED, EXTRACTED, ON_HOLD},
    SCHEDULED: {RELEASED, EXTRACTED, ON_HOLD},
    RELEASED: {SETTLED, FAILED},
    SETTLED: set(),
    FAILED: {SCHEDULED},
    REJECTED: {EXTRACTED},
    CANCELLED: set(),
    CREDIT_RECORDED: set(),
}

TERMINAL = {SETTLED, CANCELLED, CREDIT_RECORDED}


def transition(session: Session, invoice: Invoice, new_state: str, *, actor: User | None, reason: str,
               policy_ids: list[str] | None = None) -> None:
    old = invoice.lifecycle_state
    if old == new_state:
        return
    if new_state not in TRANSITIONS.get(old, set()):
        raise Conflict("INVALID_TRANSITION", f"Invoice cannot move from {old} to {new_state}.",
                       {"from": old, "to": new_state})
    invoice.lifecycle_state = new_state
    invoice.row_version += 1
    audit.record(session, actor=actor, action="invoice.transition", object_type="invoice", object_id=invoice.id,
                 object_version=invoice.current_version, before=old, after=new_state, policy_ids=policy_ids,
                 details={"reason": reason})
