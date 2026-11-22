"""Security and financial-policy hardening: rate limiting, response headers, correlation-ID
sanitizing, CSV formula neutralization, LIKE escaping, revoked identities, bounded uploads and
maker-checker on manual invoice versions."""
from __future__ import annotations

import datetime as dt

from fastapi.testclient import TestClient

from app.core.config import reset_settings
from app.db.models import AuditEvent
from app.services import audit
from tests.conftest import H, finding, inv

HARLOW = "IN-EM-008-1"  # Legal vendor → finance step (P06) normally assigned to U003


def test_mutations_are_rate_limited_per_actor(db_path, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")
    reset_settings()
    from app.main import create_app

    with TestClient(create_app()) as c:
        url = f"/api/v1/invoices/{HARLOW}/validate"
        codes_ = [c.post(url, headers=H("U004"), json={"expected_version": 999}).status_code for _ in range(4)]
        assert codes_[:3] == [409, 409, 409] and codes_[3] == 429
        r = c.post(url, headers=H("U004"), json={"expected_version": 999})
        assert r.json()["error"]["code"] == "RATE_LIMITED" and int(r.headers["Retry-After"]) >= 1
        assert c.get(f"/api/v1/invoices/{HARLOW}", headers=H("U004")).status_code == 200  # reads unaffected
        assert c.post(url, headers=H("U005"), json={"expected_version": 999}).status_code == 409  # other actor
    monkeypatch.delenv("RATE_LIMIT_PER_MINUTE")
    reset_settings()


def test_security_headers_and_document_sandbox(client):
    r = client.get(f"/api/v1/invoices/{HARLOW}", headers=H("U004"))
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Cache-Control"] == "no-store" and r.headers["Referrer-Policy"] == "no-referrer"
    doc = client.get(f"/api/v1/invoices/{HARLOW}/document", headers=H("U004"))
    assert doc.status_code == 200
    assert doc.headers["Content-Security-Policy"].startswith("sandbox; default-src 'none'")
    assert "X-Frame-Options" not in doc.headers  # the frontend may embed the source document


def test_correlation_id_is_sanitized(client):
    ok = client.get("/health", headers={"X-Correlation-Id": "abc-123"})
    assert ok.headers["x-correlation-id"] == "abc-123"
    bad = client.get("/health", headers={"X-Correlation-Id": "x\" onload=alert(1) " + "a" * 100})
    assert bad.headers["x-correlation-id"] != "x\" onload=alert(1) " + "a" * 100
    assert len(bad.headers["x-correlation-id"]) == 32


def test_audit_csv_neutralizes_formulas():
    e = AuditEvent(id=1, occurred_at=dt.datetime(2026, 11, 21), actor_id="=HYPERLINK(\"http://x\")",
                   actor_kind="human", action="+cmd", object_type="invoice", object_id="@SUM(A1)",
                   object_version=None, invoice_id=None, result="SUCCESS", before_state="-1", after_state=None,
                   policy_ids=[], evidence=[], details={}, prev_hash="0", hash="1")
    row = audit.to_csv([e]).splitlines()[1]
    assert "'=HYPERLINK" in row and ",'+cmd," in row and ",'@SUM(A1)," in row and ",'-1," in row


def test_audit_action_filter_escapes_wildcards(client):
    assert client.get("/api/v1/audit/events?action=invoice.", headers=H("U006")).json()["total"] > 0
    assert client.get("/api/v1/audit/events?action=%25", headers=H("U006")).json()["total"] == 0
    assert client.get("/api/v1/audit/events?action=_", headers=H("U006")).json()["total"] == 0


def test_terminated_identity_has_no_access(client):
    r = client.get("/api/v1/invoices", headers=H("U015"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "ACTOR_NOT_ACTIVE"


def test_oversized_upload_rejected_without_processing(client):
    big = b"%PDF-1.4\n" + b"0" * (10 * 1024 * 1024)
    r = client.post("/api/v1/invoices/upload", headers=H("U004"), files={"file": ("big.pdf", big)})
    assert r.status_code == 422 and r.json()["error"]["code"] == "FILE_SIZE_INVALID"


def test_bank_details_format_enforced(client):
    r = client.post("/api/v1/vendors/V024/bank-change-requests", headers=H("U004"),
                    json={"institution": "1", "transit": "2", "account": "3", "request_channel": "email_request"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "BANK_DETAILS_INVALID"


def test_maker_checker_on_manual_versions(client):
    d = inv(client, HARLOW)
    assert next(s for s in d["approval_chain"] if s["step_key"] == "finance_manager")["assigned_actor_id"] == "U003"
    r = client.patch(f"/api/v1/invoices/{HARLOW}/fields", headers=H("U003"),
                     json={"expected_version": d["version"], "reason": "Due date corrected per supplier call",
                           "fields": {"due_date": "2026-12-20"}})
    assert r.status_code == 200, r.text
    d = r.json()
    fin = next(s for s in d["approval_chain"] if s["step_key"] == "finance_manager")
    assert fin["assigned_actor_id"] == "U002" and "maker-checker" in fin["escalation_reason"]
    f = finding(d, "DUPLICATE_VENDOR_IDENTITY")
    r = client.post(f"/api/v1/invoices/{HARLOW}/findings/{f['id']}/dismiss", headers=H("U003"),
                    json={"expected_version": d["version"], "reason": "Same firm, different legal-name spelling."})
    assert r.status_code == 403 and r.json()["error"]["code"] == "MAKER_CANNOT_DISMISS"
    assert "U003" not in d["eligible_releasers"]


def test_document_layout_and_pages_follow_invoice_visibility(client):
    layout = client.get(f"/api/v1/invoices/{HARLOW}/document/layout", headers=H("U004"))
    assert layout.status_code == 200
    body = layout.json()
    assert body["pages"] and body["source"] in {"text", "ocr", "none"}
    page = client.get(f"/api/v1/invoices/{HARLOW}/document/pages/1", headers=H("U004"))
    assert page.status_code == 200 and page.headers["content-type"].startswith("image/")
    assert client.get(f"/api/v1/invoices/{HARLOW}/document/pages/99", headers=H("U004")).status_code == 404
