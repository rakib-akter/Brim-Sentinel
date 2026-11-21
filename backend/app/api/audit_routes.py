from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import ERRORS
from app.api.deps import get_actor, get_db
from app.core.permissions import require
from app.db.models import AuditEvent, User
from app.schemas import dto
from app.services import audit

router = APIRouter(prefix="/api/v1/audit", tags=["audit"], responses=ERRORS)


def _filtered(invoice_id: str | None, actor_id: str | None, action: str | None, result: str | None):  # noqa: ANN202
    stmt = select(AuditEvent)
    if invoice_id:
        stmt = stmt.where(AuditEvent.invoice_id == invoice_id)
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_id == actor_id)
    if action:
        stmt = stmt.where(AuditEvent.action.like(f"{action}%"))
    if result:
        stmt = stmt.where(AuditEvent.result == result.upper())
    return stmt


def _out(e: AuditEvent) -> dto.AuditEventOut:
    return dto.AuditEventOut(id=e.id, occurred_at=e.occurred_at, actor_id=e.actor_id, actor_kind=e.actor_kind,
                             action=e.action, object_type=e.object_type, object_id=e.object_id,
                             object_version=e.object_version, invoice_id=e.invoice_id, result=e.result,
                             policy_ids=e.policy_ids, evidence_refs=e.evidence, before_state=e.before_state,
                             after_state=e.after_state, details=e.details, hash=e.hash, prev_hash=e.prev_hash)


@router.get("/events", response_model=dto.AuditListOut)
def events(invoice_id: str | None = None, actor_id: str | None = None, action: str | None = None,
           result: str | None = None, limit: int = Query(200, le=1000), offset: int = 0,
           actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.AuditListOut:
    """Read-only. There is no endpoint that modifies or deletes audit events."""
    require(actor, "audit.read_all")
    stmt = _filtered(invoice_id, actor_id, action, result)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditEvent.id).limit(limit).offset(offset)).all()
    return dto.AuditListOut(items=[_out(e) for e in rows], total=total, limit=limit, offset=offset)


@router.get("/export.csv", response_class=PlainTextResponse, responses={200: {"content": {"text/csv": {}}}})
def export_csv(invoice_id: str | None = None, actor_id: str | None = None, action: str | None = None,
               actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> PlainTextResponse:
    require(actor, "audit.export")
    rows = db.scalars(_filtered(invoice_id, actor_id, action, None).order_by(AuditEvent.id)).all()
    return PlainTextResponse(audit.to_csv(list(rows)), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=brim_audit.csv"})


@router.get("/verify-chain")
def verify_chain(actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dict:
    """Recompute the hash chain (tamper-evident; not immutable without an external anchor)."""
    require(actor, "audit.read_all")
    return audit.verify_chain(db)
