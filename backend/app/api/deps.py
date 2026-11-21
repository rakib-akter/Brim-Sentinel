"""Request dependencies: DB session and demo identity.

Demo identity: `X-Demo-User-Id` (alias `X-Demo-Actor`) is accepted ONLY when DEMO_MODE=true.
It is a labelled simulation — "Demo identity — not authentication". Outside demo mode every
request is 401 because no production authentication is implemented."""
from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Unauthenticated
from app.db.models import User
from app.db.session import new_session


def get_db(request: Request) -> Iterator[Session]:
    s = new_session(write=request.method not in {"GET", "HEAD", "OPTIONS"})
    request.state.db = s  # lets the error handler roll back before auditing a denial
    try:
        yield s
    finally:
        s.rollback()  # no-op if the endpoint committed
        s.close()


def get_actor(request: Request, db: Session = Depends(get_db),
              x_demo_user_id: str | None = Header(default=None, description="Demo identity — not authentication."),
              x_demo_actor: str | None = Header(default=None, include_in_schema=False)) -> User:
    if not get_settings().demo_mode:
        raise Unauthenticated("AUTH_REQUIRED", "Demo identities are disabled (DEMO_MODE=false) and no other "
                              "authentication is configured.")
    uid = (x_demo_user_id or x_demo_actor or "").strip()
    if not uid:
        raise Unauthenticated("IDENTITY_REQUIRED", "Select a demo identity (X-Demo-User-Id header).")
    user = db.get(User, uid)
    if user is None:
        raise Unauthenticated("IDENTITY_UNKNOWN", f"Unknown demo identity {uid!r}.")
    request.state.actor_id = user.id
    return user
