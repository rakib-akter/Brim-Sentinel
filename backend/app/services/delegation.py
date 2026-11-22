"""Approver absence and delegation (brief: approvers "delegate while away"; PRD P08).

* An approver, finance manager or controller can mark themselves away and name a delegate; a
  controller/admin can do it for anyone. Anyone away can mark themselves back.
* The delegate must be an active person who can approve, and not the same person. The approval
  chain still applies every other rule to the delegate: their own limit, no self-approval, and one
  person per step (a delegate who already holds a later step is escalated, PRD edge case 3).
* Pending approval steps re-route immediately: steps waiting on the absent person move to the
  delegate, and move back when they return. Steps already decided are never changed.
* Every change is audited."""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.core.permissions import require
from app.db.models import ApprovalDecision, ApprovalStep, Invoice, User
from app.services import audit

APPROVER_ROLES = {"approver", "finance_manager", "controller_admin"}


def _target(session: Session, actor: User, user_id: str, *, allow_self_when_away: bool) -> User:
    target = session.get(User, user_id)
    if target is None or target.kind != "human":
        raise NotFound("USER_NOT_FOUND", f"No person with ID {user_id}.")
    if actor.kind != "human":
        raise Forbidden("SERVICE_IDENTITY_NOT_PERMITTED", "Service/AI identities cannot change delegation.")
    if actor.id == target.id:
        if actor.status == "terminated" or (actor.status != "active" and not allow_self_when_away):
            raise Forbidden("ACTOR_NOT_ACTIVE", f"User {actor.id} is {actor.status} and cannot act.")
    else:
        require(actor, "delegation.manage")
    if target.role not in APPROVER_ROLES:
        raise Unprocessable("NOT_AN_APPROVER", "Only people who approve invoices can set a delegate.")
    if target.status == "terminated":
        raise Unprocessable("USER_TERMINATED", f"{target.full_name} has left the company.")
    return target


def _pending_steps(session: Session, *, assigned_to: str | None = None,
                   delegated_from: str | None = None) -> list[Invoice]:
    """Invoices waiting for approval with an undecided step for (or delegated from) this person."""
    from app.services import lifecycle as lc

    q = select(ApprovalStep, Invoice).join(Invoice, (Invoice.id == ApprovalStep.invoice_id)
                                           & (Invoice.current_version == ApprovalStep.version))
    q = q.where(Invoice.lifecycle_state == lc.PENDING_APPROVAL)
    q = q.where(ApprovalStep.assigned_actor_id == assigned_to) if assigned_to else \
        q.where(ApprovalStep.delegated_from_id == delegated_from)
    out: dict[str, Invoice] = {}
    for step, inv in session.execute(q).all():
        decided = session.scalar(select(ApprovalDecision.id).where(
            ApprovalDecision.invoice_id == inv.id, ApprovalDecision.version == step.version,
            ApprovalDecision.step_key == step.step_key))
        if decided is None:
            out[inv.id] = inv
    return [out[k] for k in sorted(out)]


def _reroute(session: Session, actor: User, invoices: list[Invoice], why: str) -> list[str]:
    from app.services import pipeline

    for inv in invoices:
        pipeline.process(session, inv, actor=actor, reason=why)
    return [inv.id for inv in invoices]


def start_away(session: Session, actor: User, user_id: str, *, delegate_user_id: str,
               note: str | None = None) -> dict[str, Any]:
    target = _target(session, actor, user_id, allow_self_when_away=True)
    delegate = session.get(User, delegate_user_id)
    if delegate is None or delegate.kind != "human":
        raise Unprocessable("DELEGATE_INVALID", "Choose a delegate from the list of people.")
    if delegate.id == target.id:
        raise Unprocessable("DELEGATE_INVALID", "You can't be your own delegate.")
    if delegate.role not in APPROVER_ROLES:
        raise Unprocessable("DELEGATE_INVALID", f"{delegate.full_name} doesn't approve invoices, so they can't be "
                                                f"a delegate.")
    if delegate.status != "active":
        raise Unprocessable("DELEGATE_INVALID", f"{delegate.full_name} is not available ({delegate.status}).")
    before = {"status": target.status, "delegate_user_id": target.delegate_user_id}
    target.status = "on_leave"
    target.status_since = dt.date.today().isoformat()
    target.delegate_user_id = delegate.id
    session.flush()
    audit.record(session, actor=actor, action="user.away_started", object_type="user", object_id=target.id,
                 before=before["status"], after="on_leave", policy_ids=["P08"],
                 details={"delegate_user_id": delegate.id, "previous_delegate_user_id": before["delegate_user_id"],
                          "note": (note or "").strip() or None, "set_by_self": actor.id == target.id})
    moved = _reroute(session, actor, _pending_steps(session, assigned_to=target.id),
                     f"{target.full_name} is away; delegated to {delegate.full_name} (P08)")
    return {"user": target, "rerouted_invoice_ids": moved}


def end_away(session: Session, actor: User, user_id: str) -> dict[str, Any]:
    target = _target(session, actor, user_id, allow_self_when_away=True)
    if target.status != "on_leave":
        raise Conflict("NOT_AWAY", f"{target.full_name} is not marked as away.")
    delegate_id = target.delegate_user_id
    target.status = "active"
    target.status_since = dt.date.today().isoformat()
    target.delegate_user_id = None
    session.flush()
    audit.record(session, actor=actor, action="user.away_ended", object_type="user", object_id=target.id,
                 before="on_leave", after="active", policy_ids=["P08"],
                 details={"previous_delegate_user_id": delegate_id, "set_by_self": actor.id == target.id})
    moved = _reroute(session, actor, _pending_steps(session, delegated_from=target.id),
                     f"{target.full_name} is back; approvals return to them")
    return {"user": target, "rerouted_invoice_ids": moved}
