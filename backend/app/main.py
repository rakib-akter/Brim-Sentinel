"""Brim Sentinel API — FastAPI modular monolith. Routers are thin: parse → authorize → call
service → serialize. All financial decisions are made by backend services."""
from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.errors import DomainError
from app.db.session import init_db, session_scope
from app.services import audit

log = logging.getLogger("brim")

TAGS = [
    {"name": "meta", "description": "Health, demo identity and dashboard."},
    {"name": "invoices", "description": "Intake, extraction, coding, validation and versioned edits."},
    {"name": "approvals", "description": "Versioned human approval decisions."},
    {"name": "payments", "description": "SIMULATED payments only — no real payment rail is contacted."},
    {"name": "cases", "description": "Resolution cases, Path to Pay and the bank-change wizard."},
    {"name": "vendors", "description": "Vendor master, onboarding and bank-change verification."},
    {"name": "audit", "description": "Append-only audit events and Flight Recorder."},
]


def _error(status: int, code: str, message: str, details: dict | None, cid: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message,
                                                               "details": details or {}, "correlation_id": cid}})


def _invoice_for(s, obj_type: str, obj_id: str, request: Request) -> str | None:  # noqa: ANN001
    """Link denied attempts on cases/payments to their invoice so the Flight Recorder shows them."""
    from app.db.models import Payment, ResolutionCase

    if obj_type == "cases":
        c = s.get(ResolutionCase, obj_id)
        return c.invoice_id if c else None
    if obj_type == "payments":
        p = s.get(Payment, obj_id)
        return p.invoice_id if p else None
    return None


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Brim Sentinel API", version="1.0.0",
                  description="Detect. Resolve. Settle. Explain. — AP automation and payment controls for "
                              "Harborline Logistics (synthetic). All payments are SIMULATED. Demo identities "
                              "(X-Demo-User-Id) are a labelled simulation, not authentication.",
                  openapi_tags=TAGS)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.frontend_origins), allow_credentials=False,
                       allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
                       allow_headers=["Content-Type", "X-Demo-User-Id", "X-Demo-Actor", "Idempotency-Key"])

    @app.middleware("http")
    async def correlation(request: Request, call_next):  # noqa: ANN001, ANN202
        request.state.correlation_id = request.headers.get("x-correlation-id") or uuid.uuid4().hex
        resp = await call_next(request)
        resp.headers["x-correlation-id"] = request.state.correlation_id
        return resp

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, exc: DomainError) -> JSONResponse:
        cid = getattr(request.state, "correlation_id", uuid.uuid4().hex)
        actor_id = getattr(request.state, "actor_id", None)
        if exc.status_code in {401, 403} or (request.method != "GET" and exc.status_code in {409, 422}):
            # Denied/blocked attempts are logged in their own transaction (the business
            # transaction was rolled back, so nothing else was persisted).
            try:
                parts = [p for p in request.url.path.split("/") if p]
                obj_type = parts[2] if len(parts) > 2 else "api"
                obj_id = parts[3] if len(parts) > 3 else request.url.path
                inv_id = obj_id if obj_type == "invoices" else None
                req_db = getattr(request.state, "db", None)
                if req_db is not None:
                    req_db.rollback()  # discard any partial work and release the write lock first
                with session_scope() as s:
                    inv_id = inv_id or _invoice_for(s, obj_type, obj_id, request)
                    audit.record(s, actor=None, actor_id=actor_id, action=f"denied:{request.method} {request.url.path}",
                                 object_type=obj_type.rstrip("s"), object_id=obj_id, invoice_id=inv_id,
                                 result="DENIED" if exc.status_code in {401, 403} else "BLOCKED",
                                 details={"code": exc.code, "message": exc.message, "status": exc.status_code,
                                          "details": exc.details}, correlation_id=cid)
            except Exception:  # noqa: BLE001
                log.exception("failed to audit denied attempt")
        return _error(exc.status_code, exc.code, exc.message, exc.details, cid)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        cid = getattr(request.state, "correlation_id", uuid.uuid4().hex)
        return _error(422, "REQUEST_INVALID", "Request body or parameters are invalid.",
                      {"errors": [{"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")}
                                  for e in exc.errors()]}, cid)

    from app.api import cases, invoices, meta, payments, vendors, audit_routes

    for r in (meta.router, invoices.router, payments.router, cases.router, vendors.router, audit_routes.router):
        app.include_router(r)

    @app.on_event("startup")
    def _startup() -> None:
        init_db()

    return app


app = create_app()
