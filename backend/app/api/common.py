from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.errors import NotFound
from app.db.models import Invoice, User
from app.schemas.dto import ErrorResponse
from app.services import views

ERRORS = {s: {"model": ErrorResponse} for s in (401, 403, 404, 409, 422, 429)}


def visible_invoice(db: Session, actor: User, invoice_id: str) -> tuple[views.Ctx, Invoice]:
    inv = db.get(Invoice, invoice_id)
    ctx = views.Ctx(db, actor)
    if inv is None or not views.visible(ctx, inv):
        # 404 for both missing and not-visible: do not leak existence across scopes.
        raise NotFound("INVOICE_NOT_FOUND", f"Invoice {invoice_id} not found.")
    return ctx, inv
