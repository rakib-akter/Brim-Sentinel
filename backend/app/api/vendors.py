from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import ERRORS
from app.api.deps import get_actor, get_db
from app.core.errors import NotFound
from app.db.models import PaymentRoute, User, Vendor
from app.schemas import dto
from app.services import bank, card_routes, views

router = APIRouter(prefix="/api/v1/vendors", tags=["vendors"], responses=ERRORS)


def _vendor(db: Session, vendor_id: str) -> Vendor:
    v = db.get(Vendor, vendor_id)
    if v is None:
        raise NotFound("VENDOR_NOT_FOUND", f"Vendor {vendor_id} not found.")
    return v


@router.get("", response_model=list[dto.VendorOut])
def list_vendors(q: str | None = None, status: str | None = None, actor: User = Depends(get_actor),
                 db: Session = Depends(get_db)) -> list[dto.VendorOut]:
    ctx = views.Ctx(db, actor)
    out = []
    for v in db.scalars(select(Vendor).order_by(Vendor.id)):
        if q and q.lower() not in v.legal_name.lower() and q.lower() != v.id.lower():
            continue
        if status and v.status != status:
            continue
        out.append(views.vendor_out(ctx, v))
    return out


@router.get("/{vendor_id}", response_model=dto.VendorDetail)
def get_vendor(vendor_id: str, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.VendorDetail:
    return views.vendor_detail(views.Ctx(db, actor), _vendor(db, vendor_id))


@router.post("", response_model=dto.VendorDetail)
def onboard(body: dto.OnboardRequest, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.VendorDetail:
    """Onboarding request → vendor in pending_review (held). Activation is a separate person."""
    v = bank.onboard_vendor(db, actor, legal_name=body.legal_name, category=body.category, country=body.country,
                            province=body.province, gst_hst_number=body.gst_hst_number,
                            contact_email=body.contact_email)
    db.commit()
    return views.vendor_detail(views.Ctx(db, actor), v)


@router.post("/{vendor_id}/activate", response_model=dto.VendorDetail)
def activate(vendor_id: str, body: dto.ActivateRequest, actor: User = Depends(get_actor),
             db: Session = Depends(get_db)) -> dto.VendorDetail:
    v = bank.activate_vendor(db, actor, _vendor(db, vendor_id), notes=body.notes)
    db.commit()
    return views.vendor_detail(views.Ctx(db, actor), v)


@router.post("/{vendor_id}/bank-change-requests", response_model=dto.BankChangeOut)
def bank_change_request(vendor_id: str, body: dto.BankChangeCreate, actor: User = Depends(get_actor),
                        db: Session = Depends(get_db)) -> dto.BankChangeOut:
    """Record a bank-change REQUEST. The vendor master is not changed and the new route is
    UNVERIFIED; open invoices for the vendor are revalidated (and held)."""
    bc = bank.request_change(db, actor, _vendor(db, vendor_id), institution=body.institution, transit=body.transit,
                             account=body.account, request_channel=body.request_channel,
                             evidence_ref=body.evidence_ref)
    db.commit()
    return views.bank_change_out(views.Ctx(db, actor), bc)


@router.post("/bank-changes/{change_id}/verification", response_model=dto.BankChangeOut)
def verify(change_id: str, body: dto.VerificationRequest, actor: User = Depends(get_actor),
           db: Session = Depends(get_db)) -> dto.BankChangeOut:
    bc = bank.get_change(db, change_id)
    bank.record_verification(db, actor, bc, trusted_contact_id=body.trusted_contact_id, method=body.method,
                             occurred_at=body.occurred_at, outcome=body.outcome, notes=body.notes,
                             evidence_ref=body.evidence_ref, expected_row_version=body.expected_row_version)
    db.commit()
    return views.bank_change_out(views.Ctx(db, actor), bc)


@router.post("/bank-changes/{change_id}/authorize", response_model=dto.BankChangeOut)
def authorize(change_id: str, body: dto.AuthorizeRouteRequest, actor: User = Depends(get_actor),
              db: Session = Depends(get_db)) -> dto.BankChangeOut:
    bc = bank.get_change(db, change_id)
    bank.authorize_route(db, actor, bc, notes=body.notes, expected_row_version=body.expected_row_version)
    db.commit()
    return views.bank_change_out(views.Ctx(db, actor), bc)


# ------------------------------------------------------------------ virtual-card routes (§6.2, simulated)
@router.get("/{vendor_id}/card-routes", response_model=list[dto.CardRouteOut])
def list_card_routes(vendor_id: str, actor: User = Depends(get_actor),
                     db: Session = Depends(get_db)) -> list[dto.CardRouteOut]:
    v = _vendor(db, vendor_id)
    ctx = views.Ctx(db, actor)
    return [views.card_route_out(ctx, r) for r in db.scalars(
        select(PaymentRoute).where(PaymentRoute.vendor_id == v.id, PaymentRoute.method == "CARD")
        .order_by(PaymentRoute.id))]


@router.post("/{vendor_id}/card-routes", response_model=dto.CardRouteOut)
def register_card_route(vendor_id: str, body: dto.CardRouteCreate, actor: User = Depends(get_actor),
                        db: Session = Depends(get_db)) -> dto.CardRouteOut:
    """Register a SIMULATED Brim virtual-card route (UNVERIFIED). The merchant reference must come
    from the vendor, never from a card descriptor; a different person must verify it."""
    r = card_routes.register_card_route(db, actor, _vendor(db, vendor_id), merchant_reference=body.merchant_reference,
                                        evidence_ref=body.evidence_ref, notes=body.notes)
    db.commit()
    return views.card_route_out(views.Ctx(db, actor), r)


@router.post("/card-routes/{route_id}/verification", response_model=dto.CardRouteOut)
def verify_card_route(route_id: str, body: dto.CardRouteVerificationRequest, actor: User = Depends(get_actor),
                      db: Session = Depends(get_db)) -> dto.CardRouteOut:
    """Independent callback to a trusted contact on file before registration. Not the registrant."""
    r = card_routes.get_route(db, route_id)
    card_routes.verify_card_route(db, actor, r, trusted_contact_id=body.trusted_contact_id, method=body.method,
                                  occurred_at=body.occurred_at, outcome=body.outcome, notes=body.notes,
                                  evidence_ref=body.evidence_ref, expected_row_version=body.expected_row_version)
    db.commit()
    return views.card_route_out(views.Ctx(db, actor), r)
