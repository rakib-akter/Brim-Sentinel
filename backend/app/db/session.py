"""Engine/session management. SQLite in WAL mode with busy_timeout.

Write sessions (every mutating request, seeding, audit of denials) start with BEGIN IMMEDIATE so
competing financial mutations are serialized and release gates are re-checked inside one write
transaction. Read-only sessions use a deferred BEGIN; WAL lets them run alongside a writer."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.models import AuditEvent, Base

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _configure_sqlite(engine: Engine) -> None:
    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_conn, _record):  # noqa: ANN001
        dbapi_conn.isolation_level = None  # we issue BEGIN ourselves
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    @event.listens_for(engine, "begin")
    def _on_begin(conn):  # noqa: ANN001
        conn.exec_driver_sql("BEGIN IMMEDIATE" if conn.get_execution_options().get("brim_write") else "BEGIN")


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        url = get_settings().database_url
        _engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
        if url.startswith("sqlite"):
            _configure_sqlite(_engine)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None


def init_db() -> None:
    Base.metadata.create_all(get_engine())


def new_session(write: bool = False) -> Session:
    get_engine()
    assert _SessionLocal is not None
    s = _SessionLocal()
    if write:
        s.connection(execution_options={"brim_write": True})  # BEGIN IMMEDIATE now
    return s


@contextmanager
def session_scope() -> Iterator[Session]:
    s = new_session(write=True)
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


@event.listens_for(Session, "before_flush")
def _audit_append_only(session: Session, _ctx, _instances) -> None:  # noqa: ANN001
    for obj in list(session.dirty) + list(session.deleted):
        if isinstance(obj, AuditEvent):
            raise RuntimeError("Audit events are append-only; update/delete is not permitted")
