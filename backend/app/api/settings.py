"""Settings: editable approval policy (controller/admin) and approver delegation while away."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.common import ERRORS
from app.api.deps import get_actor, get_db
from app.core.permissions import has
from app.db.models import User
from app.schemas import dto
from app.services import delegation, policy_settings, views

router = APIRouter(tags=["settings"], responses=ERRORS)


def _policy_out(db: Session, actor: User, data: dict) -> dto.ApprovalPolicyOut:
    who = db.get(User, data["updated_by"]) if data.get("updated_by") else None
    return dto.ApprovalPolicyOut(**data, updated_by_name=who.full_name if who else None,
                                 can_edit=has(actor, "policy.edit"))


@router.get("/api/v1/settings/approval-policy", response_model=dto.ApprovalPolicyOut)
def get_policy(actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.ApprovalPolicyOut:
    """The approval rules in force, in plain words, with what a controller/admin may change."""
    return _policy_out(db, actor, policy_settings.describe(db))


@router.patch("/api/v1/settings/approval-policy", response_model=dto.ApprovalPolicyOut)
def update_policy(body: dto.ApprovalPolicyUpdate, actor: User = Depends(get_actor),
                  db: Session = Depends(get_db)) -> dto.ApprovalPolicyOut:
    """Controller/admin only. Thresholds can be made stricter, never looser than each role's authority
    limit; separation-of-duties and PO rules are locked. Audited; open, not-yet-approved invoices are
    re-routed under the new rules."""
    data = policy_settings.update(db, actor, expected_version=body.expected_version,
                                  values=body.values.model_dump(), reason=body.reason)
    db.commit()
    return _policy_out(db, actor, data)


@router.post("/api/v1/users/{user_id}/away", response_model=dto.DelegationOut)
def start_away(user_id: str, body: dto.AwayRequest, actor: User = Depends(get_actor),
               db: Session = Depends(get_db)) -> dto.DelegationOut:
    """Mark an approver as away with a delegate (self, or anyone for a controller/admin). Their pending
    approval steps move to the delegate (P08)."""
    out = delegation.start_away(db, actor, user_id, delegate_user_id=body.delegate_user_id, note=body.note)
    db.commit()
    return dto.DelegationOut(user=views.user_out(out["user"]), rerouted_invoice_ids=out["rerouted_invoice_ids"])


@router.post("/api/v1/users/{user_id}/back", response_model=dto.DelegationOut)
def end_away(user_id: str, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.DelegationOut:
    """Mark an approver as back. Steps that were delegated and not yet decided return to them."""
    out = delegation.end_away(db, actor, user_id)
    db.commit()
    return dto.DelegationOut(user=views.user_out(out["user"]), rerouted_invoice_ids=out["rerouted_invoice_ids"])
