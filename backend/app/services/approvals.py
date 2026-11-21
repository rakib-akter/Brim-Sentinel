"""ApprovalService: record a human decision bound to the current invoice version.
Never schedules or releases a payment."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.db.models import ApprovalDecision, Invoice, User
from app.services import audit, lifecycle as lc, pipeline


def decide(session: Session, actor: User, inv: Invoice, *, step_key: str, expected_version: int, decision: str,
           reason: str | None) -> Invoice:
    if inv.source_kind == "historical_ledger":
        raise Conflict("HISTORICAL_READ_ONLY", "Historical ledger records are read-only.")
    if expected_version != inv.current_version:
        raise Conflict("INVOICE_VERSION_CONFLICT", "This invoice changed. Refresh before continuing.",
                       {"expected_version": expected_version, "current_version": inv.current_version})
    if decision not in {"APPROVED", "REJECTED"}:
        raise Unprocessable("DECISION_INVALID", "decision must be APPROVED or REJECTED.")
    if actor.kind != "human":
        raise Forbidden("SERVICE_IDENTITY_NOT_PERMITTED", "AI/service identities cannot approve.")
    if actor.status != "active":
        raise Forbidden("ACTOR_NOT_ACTIVE", f"User {actor.id} is {actor.status} and cannot approve.")
    v = pipeline.current_version(session, inv)
    if actor.id == v.requester_id:
        raise Forbidden("SELF_APPROVAL_DENIED", "A requester cannot approve their own invoice (P07).",
                        {"policy": "P07"})
    if inv.lifecycle_state != lc.PENDING_APPROVAL:
        raise Conflict("INVALID_TRANSITION", f"Invoice is {inv.lifecycle_state}, not pending approval.")
    if pipeline.blocking_findings(session, inv.id, v.version):
        raise Unprocessable("HOLDS_UNRESOLVED", "Invoice has unresolved blocking findings.")
    statuses = pipeline.step_statuses(session, inv.id, v.version)
    target = next(((s, st, d) for s, st, d in statuses if s.step_key == step_key), None)
    if target is None:
        raise NotFound("STEP_NOT_FOUND", f"No approval step '{step_key}' on version {v.version}.")
    step, st, _ = target
    if st != "PENDING":
        raise Conflict("STEP_NOT_ACTIONABLE", f"Step '{step_key}' is {st}; steps are decided in order.",
                       {"status": st})
    if actor.id != step.assigned_actor_id:
        raise Forbidden("NOT_ASSIGNED_APPROVER", f"Step '{step_key}' is assigned to {step.assigned_actor_id}.",
                        {"assigned_actor_id": step.assigned_actor_id})
    if any(d is not None and d.actor_id == actor.id for _s, _st, d in statuses):
        raise Forbidden("ONE_PERSON_ONE_STEP", "You already decided another step on this invoice version.")
    if decision == "REJECTED" and (not reason or len(reason.strip()) < 5):
        raise Unprocessable("REASON_REQUIRED", "A reason is required to reject.")
    session.add(ApprovalDecision(id=f"AD-{inv.id}-v{v.version}-{step_key}", invoice_id=inv.id, version=v.version,
                                 step_key=step_key, actor_id=actor.id, delegated_from_id=step.delegated_from_id,
                                 decision=decision, reason=reason, source="app"))
    session.flush()
    audit.record(session, actor=actor, action=f"approval.{decision.lower()}", object_type="invoice",
                 object_id=inv.id, object_version=v.version, policy_ids=step.policy_ids,
                 details={"step": step_key, "delegated_from": step.delegated_from_id, "reason": reason,
                          "amount_cad_minor": v.amount_cad_minor})
    if decision == "REJECTED":
        lc.transition(session, inv, lc.REJECTED, actor=actor, reason=f"rejected at step {step_key}: {reason}")
    elif pipeline.all_approved(session, inv.id, v.version):
        lc.transition(session, inv, lc.APPROVED, actor=actor, reason="all required approvals recorded")
    inv.row_version += 1
    return inv
