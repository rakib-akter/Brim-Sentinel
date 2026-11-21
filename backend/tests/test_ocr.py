"""FR-02 local OCR: unseen scanned PNG / JPEG / image-only PDF invoices, provenance, and the
rule that uncertain fields are left blank rather than invented."""
from __future__ import annotations

import io
from pathlib import Path

import pytest

from app.core.config import get_settings, reset_settings
from app.services import extraction, ocr
from tests.conftest import H, codes, inv

pytestmark = pytest.mark.skipif(not ocr.available(), reason="local OCR engine not installed")

DATA = get_settings().data_dir / "incoming_invoices"
SOURCE_PDF = DATA / "Invoice 000809.pdf"  # text-layer PDF used to synthesise unseen scans


def _render(fmt: str) -> tuple[str, bytes]:
    import pymupdf
    from PIL import Image

    with pymupdf.open(SOURCE_PDF) as doc:
        pix = doc[0].get_pixmap(dpi=150, alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    buf = io.BytesIO()
    if fmt == "png":
        img.save(buf, "PNG")
        return "unseen_scan.png", buf.getvalue()
    if fmt == "jpeg":
        img.save(buf, "JPEG", quality=80)
        return "unseen_scan.jpg", buf.getvalue()
    img.rotate(1.0, expand=True, fillcolor="white").save(buf, "PDF", resolution=150)
    return "unseen_scan.pdf", buf.getvalue()


def test_dataset_scans_are_ocrd_and_match_transcriptions():
    for name in ("scan_8049.png", "scan_8749.png"):
        ex = extraction.extract_document(DATA / name, name)
        ref = extraction.parse_text(extraction.fixture_text(name), "demo_fixture")
        assert ex.provenance == "ocr" and ex.status == "EXTRACTED" and ex.uncertain_fields == []
        for f in ("vendor_tax_id", "invoice_number", "invoice_date", "due_date", "currency", "subtotal_minor",
                  "total_minor", "ship_to_province"):
            assert getattr(ex, f) == getattr(ref, f), f
        assert [t["amount_minor"] for t in ex.taxes] == [t["amount_minor"] for t in ref.taxes]
        assert [ln.amount_minor for ln in ex.lines] == [ln.amount_minor for ln in ref.lines]
        assert ex.remit["account_full"] == ref.remit["account_full"]
        assert ex.ocr["engine"] == ocr.ENGINE_NAME and ex.ocr["mean_confidence"] > 0.9


@pytest.mark.parametrize("fmt", ["png", "jpeg", "pdf"])
def test_unseen_scan_upload_runs_real_ocr(client, fmt):
    ref = extraction.parse_text(extraction.read_text_layer(SOURCE_PDF), "pdf_text")
    name, content = _render(fmt)
    r = client.post("/api/v1/invoices/upload", headers=H("U004"), files={"file": (name, content)})
    assert r.status_code == 200, r.text
    d = inv(client, r.json()["invoice"]["id"])
    assert d["provenance"] == "ocr"
    doc = d["document_refs"][0]
    assert doc["extraction_provenance"] == "ocr" and doc["ocr"]["engine"] == ocr.ENGINE_NAME
    assert doc["ocr"]["engine_version"] and doc["ocr"]["min_confidence_threshold"] == get_settings().ocr_min_confidence
    # Every value the OCR did commit to must equal the text-layer truth; anything else is UNKNOWN.
    for field, ref_val in (("invoice_number", ref.invoice_number), ("amount_minor", ref.total_minor),
                           ("invoice_date", ref.invoice_date)):
        assert d[field] in {ref_val, None}, field
    assert d["amount_minor"] == ref.total_minor
    # Same supplier invoice already arrived by email → the scan is caught as a duplicate, not paid twice.
    assert d["lifecycle_state"] == "ON_HOLD"


def test_low_confidence_values_are_left_unknown_not_guessed():
    text = extraction.fixture_text("scan_8049.png")
    conf = {ln.strip(): 0.99 for ln in text.splitlines() if ln.strip()}
    conf["$6,693.69"] = 0.41  # total amount barely legible
    conf["Inst. 003   Transit 92968   Acct 953389679"] = 0.55  # bank digits barely legible
    ex = extraction.parse_text(text, "ocr", line_conf=conf, min_conf=0.80)
    assert ex.total_minor is None and "total" in ex.uncertain_fields
    assert ex.remit == {} and "remit" in ex.uncertain_fields
    assert ex.subtotal_minor == 582187  # confident values are still read


def test_low_confidence_total_creates_extraction_hold(client, monkeypatch):
    real_run = ocr.run

    def degraded(path: Path) -> ocr.OcrResult:
        res = real_run(path)
        res.confidences = [0.3 if line.startswith("$") else c for line, c in zip(res.lines, res.confidences)]
        return res

    monkeypatch.setattr(ocr, "run", degraded)
    name, content = _render("png")
    r = client.post("/api/v1/invoices/upload", headers=H("U004"), files={"file": (name, content)})
    assert r.status_code == 200, r.text
    d = inv(client, r.json()["invoice"]["id"])
    assert d["provenance"] == "ocr" and d["amount_minor"] is None
    assert "EXTRACTION_INCOMPLETE" in codes(d) and d["lifecycle_state"] == "ON_HOLD"


def test_blank_scan_needs_manual_extraction(client):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (800, 1000), "white").save(buf, "PNG")
    r = client.post("/api/v1/invoices/upload", headers=H("U004"), files={"file": ("blank.png", buf.getvalue())})
    assert r.status_code == 200, r.text
    d = inv(client, r.json()["invoice"]["id"])
    assert d["provenance"] == "none" and "document" in d["uncertain_fields"]
    assert "EXTRACTION_INCOMPLETE" in codes(d)


def test_oversized_image_is_refused_before_decoding(tmp_path):
    from PIL import Image

    p = tmp_path / "huge.png"
    Image.new("1", (8000, 6000), 1).save(p)  # 48 MP, tiny on disk
    res = ocr.run(p)
    assert res.status == "REJECTED" and "too large" in (res.message or "")


def test_ocr_disabled_falls_back_to_labelled_fixture_or_manual(monkeypatch):
    monkeypatch.setenv("OCR_ENABLED", "false")
    reset_settings()
    try:
        ex = extraction.extract_document(DATA / "scan_8049.png", "scan_8049.png")
        assert ex.provenance == "demo_fixture" and ex.ocr["status"] == "UNAVAILABLE"
        unseen = extraction.extract_document(DATA / "scan_8049.png", "not_a_fixture.png")
        assert unseen.provenance == "none" and unseen.status == "NEEDS_MANUAL_EXTRACTION"
    finally:
        monkeypatch.delenv("OCR_ENABLED")
        reset_settings()


def test_whitespace_restoration_never_changes_characters():
    vocab = ocr.vocabulary()
    for raw in ("LTLshipmentCalgary-Edmonton", "PrairieNatural GasUtility", "Fuel surcharge(7.07%)",
                "Xqzvbnmwrt", "GST/HST669086667RT0001", "Inst.003 Transit 92968 Acct 953389679"):
        out = ocr.normalize_line(raw, vocab)
        assert out.replace(" ", "") == raw.replace(" ", ""), (raw, out)
    assert ocr.normalize_line("Xqzvbnmwrt", vocab) == "Xqzvbnmwrt"  # unknown text left as read
    assert ocr.normalize_line("S224.73", vocab) == "$224.73"  # currency symbol only
    assert ocr.normalize_line("S224", vocab) == "S224"
