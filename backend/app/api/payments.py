from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import ERRORS, visible_invoice
from app.api.deps import get_actor, get_db
from app.core.errors import NotFound
from app.db.models import Invoice, Payment, User
from app.schemas import dto
from app.services import payments as pay_svc, views

router = APIRouter(prefix="/api/v1/payments", tags=["payments"], responses=ERRORS)


def _visible_payment(db: Session, actor: User, payment_id: str) -> Payment:
    p = db.get(Payment, payment_id)
    if p is None:
        raise NotFound("PAYMENT_NOT_FOUND", f"Payment {payment_id} not found.")
    visible_invoice(db, actor, p.invoice_id)
    return p


@router.get("", response_model=list[dto.PaymentOut])
def list_payments(state: str | None = None, include_history: bool = False, actor: User = Depends(get_actor),
                  db: Session = Depends(get_db)) -> list[dto.PaymentOut]:
    ctx = views.Ctx(db, actor)
    stmt = select(Payment).order_by(Payment.created_at.desc())
    if not include_history:
        stmt = stmt.where(Payment.source == "simulation")
    if state:
        stmt = stmt.where(Payment.state == state.upper())
    out = []
    for p in db.scalars(stmt):
        inv = db.get(Invoice, p.invoice_id)
        if inv is not None and views.visible(ctx, inv):
            out.append(views.payment_out(p))
    return out


@router.post("/prepare", response_model=dto.PaymentOut)
def prepare(body: dto.PrepareRequest, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.PaymentOut:
    """Schedule a SIMULATED payment for an approved invoice (AP clerk prepares; P09)."""
    _ctx, inv = visible_invoice(db, actor, body.invoice_id)
    p = pay_svc.prepare(db, actor, inv, expected_version=body.expected_version, method=body.method)
    db.commit()
    return views.payment_out(p)


@router.get("/{payment_id}", response_model=dto.PaymentOut)
def get_payment(payment_id: str, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.PaymentOut:
    return views.payment_out(_visible_payment(db, actor, payment_id))


@router.post("/{payment_id}/release", response_model=dto.ReleaseOut)
def release(payment_id: str, body: dto.ReleaseRequest,
            idempotency_key: str = Header(..., alias="Idempotency-Key"),
            actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.ReleaseOut:
    """Independent authorized release of a SIMULATED payment. All gates re-checked in one write
    transaction. Same Idempotency-Key + same body → original result; different body → 409."""
    _visible_payment(db, actor, payment_id)
    res = pay_svc.release(db, actor, payment_id, idempotency_key=idempotency_key,
                          expected_invoice_version=body.expected_invoice_version, serialize=views.payment_json)
    db.commit()
    return dto.ReleaseOut(**res)


@router.post("/{payment_id}/simulate-settlement", response_model=dto.PaymentOut)
def settle(payment_id: str, body: dto.SettleRequest, actor: User = Depends(get_actor),
           db: Session = Depends(get_db)) -> dto.PaymentOut:
    """Record a SIMULATED settlement outcome. No funds move."""
    _visible_payment(db, actor, payment_id)
    p = pay_svc.settle(db, actor, payment_id, outcome=body.outcome)
    db.commit()
    return views.payment_out(p)
