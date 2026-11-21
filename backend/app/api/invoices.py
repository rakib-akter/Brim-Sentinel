from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import ERRORS, visible_invoice
from app.api.deps import get_actor, get_db
from app.core.errors import NotFound
from app.core.permissions import require
from app.db.models import Document, Invoice, User
from app.schemas import dto
from app.services import approvals, card_routes, intake, invoices as inv_svc, pipeline, views

router = APIRouter(prefix="/api/v1/invoices", tags=["invoices"], responses=ERRORS)

STATUS_FILTERS = {
    "attention": {"ON_HOLD", "DRAFT", "RECEIVED"},
    "approval": {"PENDING_APPROVAL"},
    "payment": {"APPROVED", "SCHEDULED", "RELEASED", "FAILED"},
    "done": {"SETTLED", "CREDIT_RECORDED", "REJECTED", "CANCELLED"},
}


@router.get("", response_model=dto.InvoiceListOut)
def list_invoices(q: str | None = None, status: str | None = Query(None, description="attention|approval|payment|done or a lifecycle state"),
                  include_history: bool = False, limit: int = Query(100, le=500), offset: int = 0,
                  actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.InvoiceListOut:
    ctx = views.Ctx(db, actor)
    stmt = select(Invoice).order_by(Invoice.id)
    if not include_history:
        stmt = stmt.where(Invoice.source_kind != "historical_ledger")
    if status:
        states = STATUS_FILTERS.get(status, {status.upper()})
        stmt = stmt.where(Invoice.lifecycle_state.in_(states))
    rows = []
    for inv in db.scalars(stmt):
        v = pipeline.current_version(db, inv)
        if not views.visible(ctx, inv, v):
            continue
        if q:
            vendor = ctx.vendors.get(inv.vendor_id or "")
            hay = " ".join(filter(None, [inv.id, v.invoice_number_raw, v.vendor_name_raw,
                                         vendor.legal_name if vendor else None])).lower()
            if q.lower() not in hay:
                continue
        rows.append((inv, v))
    page = rows[offset: offset + limit]
    return dto.InvoiceListOut(items=[views.summary(ctx, i, v) for i, v in page], total=len(rows), limit=limit,
                              offset=offset)


@router.post("/upload", response_model=dto.UploadOut)
async def upload(file: UploadFile = File(...), actor: User = Depends(get_actor),
                 db: Session = Depends(get_db)) -> dto.UploadOut:
    """Upload an unseen PDF/PNG invoice. Same pipeline as email intake; idempotent per (uploader, SHA-256)."""
    require(actor, "invoice.upload")
    content = await file.read()
    doc, created = intake.store_upload(db, actor=actor, filename=file.filename or "upload", content=content)
    inv = intake.find_invoice_for_document(db, doc.id)
    if inv is None:
        inv = pipeline.create_from_document(db, invoice_id=f"UP-{doc.sha256[:10].upper()}", document_id=doc.id,
                                            email_id=None, source_kind="upload", actor=actor,
                                            received_date=__import__("datetime").date.today().isoformat(),
                                            uploader=actor)
        created = True
    db.commit()
    return dto.UploadOut(created=created, invoice=views.summary(views.Ctx(db, actor), inv))


@router.get("/{invoice_id}", response_model=dto.InvoiceDetail)
def get_invoice(invoice_id: str, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.InvoiceDetail:
    ctx, inv = visible_invoice(db, actor, invoice_id)
    return views.detail(ctx, inv)


@router.get("/{invoice_id}/document", response_class=FileResponse,
            responses={200: {"content": {"application/pdf": {}, "image/png": {}}}})
def get_document(invoice_id: str, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> FileResponse:
    """Original source document (access-checked against invoice visibility)."""
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    doc = db.get(Document, inv.document_id) if inv.document_id else None
    if doc is None or not Path(doc.storage_path).exists():
        raise NotFound("DOCUMENT_NOT_FOUND", "No source document for this invoice.")
    return FileResponse(doc.storage_path, media_type=doc.mime_type, filename=doc.filename)


@router.get("/{invoice_id}/flight-recorder", response_model=dto.FlightRecorderOut, tags=["audit"])
def flight_recorder(invoice_id: str, actor: User = Depends(get_actor),
                    db: Session = Depends(get_db)) -> dto.FlightRecorderOut:
    ctx, inv = visible_invoice(db, actor, invoice_id)
    return views.flight_recorder(ctx, inv)


@router.get("/{invoice_id}/duplicates", response_model=list[dto.DuplicateOut])
def duplicates(invoice_id: str, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> list[dto.DuplicateOut]:
    ctx, inv = visible_invoice(db, actor, invoice_id)
    return views.detail(ctx, inv).duplicate_candidates


@router.get("/{invoice_id}/approvals", response_model=list[dto.ApprovalStepOut], tags=["approvals"])
def approval_chain(invoice_id: str, actor: User = Depends(get_actor),
                   db: Session = Depends(get_db)) -> list[dto.ApprovalStepOut]:
    ctx, inv = visible_invoice(db, actor, invoice_id)
    return views.detail(ctx, inv).approval_chain


def _after(db: Session, actor: User, inv: Invoice) -> dto.InvoiceDetail:
    db.commit()
    return views.detail(views.Ctx(db, actor), inv)


@router.patch("/{invoice_id}/fields", response_model=dto.InvoiceDetail)
def edit_fields(invoice_id: str, body: dto.EditFieldsRequest, actor: User = Depends(get_actor),
                db: Session = Depends(get_db)) -> dto.InvoiceDetail:
    """Authorized edit → new immutable version; prior approvals invalidated; full revalidation."""
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    inv_svc.edit_fields(db, actor, inv, expected_version=body.expected_version, reason=body.reason, fields=body.fields)
    return _after(db, actor, inv)


@router.post("/{invoice_id}/validate", response_model=dto.InvoiceDetail)
def revalidate(invoice_id: str, body: dto.VersionedRequest, actor: User = Depends(get_actor),
               db: Session = Depends(get_db)) -> dto.InvoiceDetail:
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    inv_svc.revalidate(db, actor, inv, expected_version=body.expected_version)
    return _after(db, actor, inv)


@router.post("/{invoice_id}/coding/decision", response_model=dto.InvoiceDetail)
def coding_decision(invoice_id: str, body: dto.CodingDecisionRequest, actor: User = Depends(get_actor),
                    db: Session = Depends(get_db)) -> dto.InvoiceDetail:
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    inv_svc.coding_decision(db, actor, inv, expected_version=body.expected_version,
                            lines=[ln.model_dump() for ln in body.lines])
    return _after(db, actor, inv)


@router.post("/{invoice_id}/findings/{finding_id}/dismiss", response_model=dto.InvoiceDetail)
def dismiss(invoice_id: str, finding_id: str, body: dto.DismissRequest, actor: User = Depends(get_actor),
            db: Session = Depends(get_db)) -> dto.InvoiceDetail:
    """Authorized, reasoned false-positive dismissal. Hard holds are not dismissible."""
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    inv_svc.dismiss_finding(db, actor, inv, finding_id=finding_id, expected_version=body.expected_version,
                            reason=body.reason)
    return _after(db, actor, inv)


@router.post("/{invoice_id}/cancel", response_model=dto.InvoiceDetail)
def cancel(invoice_id: str, body: dto.CancelRequest, actor: User = Depends(get_actor),
           db: Session = Depends(get_db)) -> dto.InvoiceDetail:
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    inv_svc.cancel(db, actor, inv, expected_version=body.expected_version, reason=body.reason)
    return _after(db, actor, inv)


@router.post("/{invoice_id}/approvals/{step_key}/decision", response_model=dto.InvoiceDetail, tags=["approvals"])
def decide(invoice_id: str, step_key: str, body: dto.ApprovalDecisionRequest, actor: User = Depends(get_actor),
           db: Session = Depends(get_db)) -> dto.InvoiceDetail:
    """Record an approval/rejection bound to the current invoice version. Never releases payment."""
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    approvals.decide(db, actor, inv, step_key=step_key, expected_version=body.expected_version,
                     decision=body.decision, reason=body.reason)
    return _after(db, actor, inv)


# ------------------------------------------------------------------ payment-method change (§6.2)
@router.get("/{invoice_id}/payment-method-changes", response_model=list[dto.MethodChangeOut], tags=["payments"])
def list_method_changes(invoice_id: str, actor: User = Depends(get_actor),
                        db: Session = Depends(get_db)) -> list[dto.MethodChangeOut]:
    ctx, inv = visible_invoice(db, actor, invoice_id)
    return [views.method_change_out(ctx, c) for c in card_routes.changes_for(db, inv.id)]


@router.post("/{invoice_id}/payment-method-changes", response_model=dto.MethodChangeOut, tags=["payments"])
def request_method_change(invoice_id: str, body: dto.MethodChangeCreate, actor: User = Depends(get_actor),
                          db: Session = Depends(get_db)) -> dto.MethodChangeOut:
    """Request EFT → simulated Brim virtual card for the current invoice version. Requires vendor
    card acceptance and an independently VERIFIED card route. A request is not an authorization."""
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    c = card_routes.request_change(db, actor, inv, expected_version=body.expected_version, to_method=body.to_method,
                                   reason=body.reason)
    db.commit()
    return views.method_change_out(views.Ctx(db, actor), c)


@router.post("/{invoice_id}/payment-method-changes/{change_id}/decision", response_model=dto.MethodChangeOut,
             tags=["payments"])
def decide_method_change(invoice_id: str, change_id: str, body: dto.MethodChangeDecisionRequest,
                         actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.MethodChangeOut:
    """Finance-manager authorization (or decline) of a method change. The authorizer must differ from
    the requester, the invoice requester and the card-route registrant/verifier; on authorization the
    invoice is revalidated. Never approves the invoice or releases funds."""
    _ctx, inv = visible_invoice(db, actor, invoice_id)
    c = card_routes.get_change(db, change_id)
    if c.invoice_id != inv.id:
        raise NotFound("METHOD_CHANGE_NOT_FOUND", f"Payment-method change {change_id} not found on {inv.id}.")
    card_routes.decide_change(db, actor, c, decision=body.decision, notes=body.notes,
                              expected_row_version=body.expected_row_version)
    db.commit()
    return views.method_change_out(views.Ctx(db, actor), c)
