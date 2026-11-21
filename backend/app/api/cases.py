from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import ERRORS, visible_invoice
from app.api.deps import get_actor, get_db
from app.core.errors import Unprocessable
from app.db.models import Invoice, ResolutionCase, User
from app.schemas import dto
from app.services import bank, resolution, views

router = APIRouter(prefix="/api/v1/cases", tags=["cases"], responses=ERRORS)


def _case(db: Session, actor: User, case_id: str) -> tuple[views.Ctx, ResolutionCase]:
    c = resolution.get_case(db, case_id)
    ctx, _inv = visible_invoice(db, actor, c.invoice_id)
    return ctx, c


@router.get("", response_model=dto.CaseListOut)
def list_cases(state: str | None = None, open_only: bool = True, actor: User = Depends(get_actor),
               db: Session = Depends(get_db)) -> dto.CaseListOut:
    ctx = views.Ctx(db, actor)
    stmt = select(ResolutionCase).order_by(ResolutionCase.created_at)
    if state:
        stmt = stmt.where(ResolutionCase.state == state.upper())
    elif open_only:
        stmt = stmt.where(ResolutionCase.state.not_in(resolution.CLOSED_STATES))
    items = []
    for c in db.scalars(stmt):
        inv = db.get(Invoice, c.invoice_id)
        if inv is not None and views.visible(ctx, inv):
            items.append(views.case_summary(ctx, c))
    sev = resolution.SEVERITY_RANK
    items.sort(key=lambda c: (-sev.get(c.severity, 0), c.id))
    return dto.CaseListOut(items=items, total=len(items))


@router.get("/{case_id}", response_model=dto.CaseDetail)
def get_case(case_id: str, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.CaseDetail:
    ctx, c = _case(db, actor, case_id)
    return views.case_detail(ctx, c)


@router.post("/{case_id}/actions", response_model=dto.CaseDetail)
def case_action(case_id: str, body: dto.CaseActionRequest, actor: User = Depends(get_actor),
                db: Session = Depends(get_db)) -> dto.CaseDetail:
    """Human case actions. `request_information` returns a DRAFT message only (a person sends it).
    `document_decision` (controller/CFO) can reject or keep on hold — there is no release override."""
    ctx, c = _case(db, actor, case_id)
    resolution.add_action(db, actor, c, action_type=body.action_type, notes=body.notes,
                          expected_row_version=body.expected_row_version, decision=body.decision)
    db.commit()
    return views.case_detail(views.Ctx(db, actor), c)


@router.post("/{case_id}/bank-verification", response_model=dto.CaseDetail)
def bank_verification(case_id: str, body: dto.VerificationRequest, actor: User = Depends(get_actor),
                      db: Session = Depends(get_db)) -> dto.CaseDetail:
    """Wizard step 2: record an independent callback to a trusted contact already on file."""
    ctx, c = _case(db, actor, case_id)
    if not c.bank_change_id:
        raise Unprocessable("NOT_A_BANK_CHANGE_CASE", "This case has no linked bank change.")
    bc = bank.get_change(db, c.bank_change_id)
    bank.record_verification(db, actor, bc, trusted_contact_id=body.trusted_contact_id, method=body.method,
                             occurred_at=body.occurred_at, outcome=body.outcome, notes=body.notes,
                             evidence_ref=body.evidence_ref, expected_row_version=body.expected_row_version)
    db.commit()
    return views.case_detail(views.Ctx(db, actor), c)


@router.post("/{case_id}/route-authorization", response_model=dto.CaseDetail)
def route_authorization(case_id: str, body: dto.AuthorizeRouteRequest, actor: User = Depends(get_actor),
                        db: Session = Depends(get_db)) -> dto.CaseDetail:
    """Wizard step 3: finance manager/controller (not the verifier) authorizes the verified route;
    affected invoices are revalidated deterministically."""
    ctx, c = _case(db, actor, case_id)
    if not c.bank_change_id:
        raise Unprocessable("NOT_A_BANK_CHANGE_CASE", "This case has no linked bank change.")
    bc = bank.get_change(db, c.bank_change_id)
    bank.authorize_route(db, actor, bc, notes=body.notes, expected_row_version=body.expected_row_version)
    db.commit()
    return views.case_detail(views.Ctx(db, actor), c)


@router.post("/{case_id}/authorization-request", response_model=dto.CaseDetail)
def authorization_request(case_id: str, body: dto.AuthorizationRequestBody, actor: User = Depends(get_actor),
                          db: Session = Depends(get_db)) -> dto.CaseDetail:
    """Wizard step 4: request approvals. This is NOT an approval or a release."""
    ctx, c = _case(db, actor, case_id)
    resolution.request_authorization(db, actor, c, expected_invoice_version=body.expected_invoice_version,
                                     notes=body.notes)
    db.commit()
    return views.case_detail(views.Ctx(db, actor), c)


@router.post("/{case_id}/investigate", response_model=dto.InvestigationOut)
def investigate(case_id: str, actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.InvestigationOut:
    """Bounded read-only investigation (≤ 8 allowlisted lookups, masked data, cited output).
    AI is off by default → deterministic template. Never changes holds, cases or approvals."""
    from app.services import investigation

    _ctx, c = _case(db, actor, case_id)
    out = investigation.investigate(db, actor, c)
    db.commit()
    return dto.InvestigationOut(**out)
