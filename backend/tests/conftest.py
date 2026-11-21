"""Test fixtures. The real synthetic dataset is seeded ONCE into a template SQLite file; each test
gets a fresh copy so tests are isolated and order-independent. AI is disabled; no network."""
from __future__ import annotations

import os
import shutil
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("AI_ENABLED", "false")


def _configure(db_path: Path, upload_dir: Path, demo_mode: bool = True) -> None:
    from app.core.config import reset_settings
    from app.db.session import reset_engine

    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["BRIM_UPLOAD_DIR"] = str(upload_dir)
    os.environ["DEMO_MODE"] = "true" if demo_mode else "false"
    reset_settings()
    reset_engine()


@pytest.fixture(scope="session")
def template_db(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("template")
    path = d / "template.db"
    _configure(path, d / "uploads")
    from app.db.session import init_db, reset_engine, session_scope
    from app.db.seed import run_seed

    init_db()
    with session_scope() as s:
        run_seed(s)
    reset_engine()
    con = sqlite3.connect(path)
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.execute("PRAGMA journal_mode=DELETE")
    con.close()
    return path


@pytest.fixture()
def db_path(template_db, tmp_path) -> Path:
    p = tmp_path / "test.db"
    shutil.copy(template_db, p)
    _configure(p, tmp_path / "uploads")
    yield p
    from app.db.session import reset_engine
    reset_engine()


@pytest.fixture()
def client(db_path) -> TestClient:
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


@pytest.fixture()
def session(db_path):
    from app.db.session import new_session

    s = new_session()
    yield s
    s.rollback()
    s.close()


def H(uid: str, **extra: str) -> dict[str, str]:
    return {"X-Demo-User-Id": uid, **extra}


def inv(client: TestClient, invoice_id: str, uid: str = "U004") -> dict:
    r = client.get(f"/api/v1/invoices/{invoice_id}", headers=H(uid))
    assert r.status_code == 200, r.text
    return r.json()


def codes(detail: dict, blocking_only: bool = True) -> set[str]:
    return {f["code"] for f in detail["validation_findings"]
            if (f["blocking"] if blocking_only else f["result"] in {"FAIL", "UNKNOWN"})}


def finding(detail: dict, code: str) -> dict:
    return next(f for f in detail["validation_findings"] if f["code"] == code)
