from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import ERRORS
from app.api.deps import get_actor, get_db
from app.core.permissions import PERMISSIONS, has, require
from app.db.models import User
from app.db.seed import run_seed
from app.schemas import dto
from app.services import views

router = APIRouter(tags=["meta"], responses=ERRORS)


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "simulation": True}


@router.get("/api/v1/demo-identities", response_model=dto.DemoIdentitiesOut)
def demo_identities(db: Session = Depends(get_db)) -> dto.DemoIdentitiesOut:
    """Identity picker source. Demo identity — not authentication."""
    users = db.scalars(select(User).order_by(User.id)).all()
    return dto.DemoIdentitiesOut(users=[views.user_out(u) for u in users])


@router.get("/api/v1/me", response_model=dto.MeOut)
def me(actor: User = Depends(get_actor)) -> dto.MeOut:
    return dto.MeOut(user=views.user_out(actor), permissions=sorted(p for p in PERMISSIONS if has(actor, p)))


@router.get("/api/v1/dashboard", response_model=dto.DashboardOut)
def dashboard(actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.DashboardOut:
    """FR-10 role-scoped Home: Needs your attention / Ready for approval / Upcoming payments."""
    return views.dashboard(views.Ctx(db, actor))


@router.post("/api/v1/invoices/import", response_model=dto.ImportOut, tags=["invoices"])
def import_dataset(actor: User = Depends(get_actor), db: Session = Depends(get_db)) -> dto.ImportOut:
    """Idempotent import of the dataset and inbox (re-running creates no duplicates)."""
    require(actor, "intake.import")
    counts = run_seed(db)
    db.commit()
    return dto.ImportOut(counts=counts)
