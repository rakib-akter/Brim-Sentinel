"""Acceptance fixtures from PRD §10.1 run against the real seeded dataset."""
from sqlalchemy import func, select

from app.db.models import EmailMessage, IntakeItem, Invoice
from tests.conftest import H, codes, finding, inv


def test_intake_counts_and_multi_attachment(client, session):  # FR-01
    assert session.scalar(select(func.count()).select_from(EmailMessage)) == 59
    drafts = session.scalars(select(Invoice).where(Invoice.source_kind == "email_intake")).all()
    assert len(drafts) == 56
    assert {i.id for i in drafts if i.email_id == "EM-029"} == {"IN-EM-029-1", "IN-EM-029-2"}


def test_at02_at24_non_payable_and_missing_document(session):
    items = {i.email_id: i for i in session.scalars(select(IntakeItem).where(IntakeItem.invoice_id.is_(None)))}
    assert items["EM-058"].item_type == "missing_document" and items["EM-058"].status == "OPEN"
    assert items["EM-056"].item_type == "statement"
    assert items["EM-057"].item_type == "payment_inquiry"
    assert items["EM-059"].item_type == "non_ap"
    assert not any(i.payable for i in items.values())
    assert session.scalar(select(func.count()).select_from(Invoice).where(
        Invoice.email_id.in_(["EM-056", "EM-057", "EM-058", "EM-059"]))) == 0


def test_reimport_is_idempotent(client):
    before = client.get("/api/v1/invoices?limit=500", headers=H("U004")).json()["total"]
    r = client.post("/api/v1/invoices/import", headers=H("U004"))
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["intake"]["drafts_created"] == 0
    assert client.get("/api/v1/invoices?limit=500", headers=H("U004")).json()["total"] == before


def test_at01_french_invoice_taxes_and_scan_provenance(client):
    d = inv(client, "IN-EM-022-1")  # laurentianlogist_FA002399.pdf
    assert d["language"] == "fr" and d["provenance"] == "pdf_text"
    kinds = {t["kind"]: t["amount_minor"] for t in d["taxes"]}
    assert kinds == {"GST": 21813, "QST": 43518}
    scan = inv(client, "IN-EM-011-1")  # scan_8749.png — read by local OCR, not a fixture
    assert scan["provenance"] == "ocr"
    assert scan["document_refs"][0]["extraction_provenance"] == "ocr"
    assert scan["invoice_number"] == "PR26-1012" and scan["amount_minor"] == 471928
    assert scan["uncertain_fields"] == []


def test_at03_unknown_vendor_held(client):
    for iid in ("IN-EM-001-1", "IN-EM-006-1"):  # Blue Heron, Zephyr
        d = inv(client, iid)
        assert d["lifecycle_state"] == "ON_HOLD" and "UNKNOWN_VENDOR" in codes(d)
        assert any(c["case_type"] == "UNKNOWN_VENDOR" for c in d["resolution_cases"])


def test_at04_fuel_surcharge_cap(client):
    d = inv(client, "IN-EM-004-1")  # Polar 000964 fuel 22% vs 12% cap
    f = finding(d, "FUEL_SURCHARGE_CAP_EXCEEDED")
    assert f["blocking"] and f["data"]["cap_pct"] == "12" and "22" in f["rationale"]
    assert any(e["type"] == "contract" and e["ref"] == "C018" for e in f["evidence_refs"])


def test_at05_wrong_provincial_tax(client):
    d = inv(client, "IN-EM-027-1")  # Northbound billed HST 13% to an AB address
    assert d["lifecycle_state"] == "ON_HOLD" and "TAX_MISMATCH" in codes(d)
    d = inv(client, "IN-EM-014-1")  # Beaumont: QC delivery without QST
    assert "QST" in finding(d, "TAX_MISMATCH")["rationale"]


def test_at06_reformatted_duplicate_numbers(client):
    d = inv(client, "IN-EM-017-1")  # Voyageur 000903-A vs paid 000903
    dup = next(x for x in d["duplicate_candidates"] if x["match_type"] == "NORMALIZED_NUMBER")
    assert dup["matched_invoice_id"] == "AP-00277" and not dup["confirmed"]
    d = inv(client, "IN-EM-031-1")  # Brightline 583 vs FA-000583
    assert any(x["matched_invoice_id"] == "AP-00330" for x in d["duplicate_candidates"])


def test_at07_card_paid_duplicate(client):
    d = inv(client, "IN-EM-045-1")  # Cloudbarn INV-01561, paid by Brim card CT-00556
    card = [x for x in d["duplicate_candidates"] if x["match_type"] == "CARD_PAID"]
    assert card and card[0]["matched_card_txn_id"] == "CT-00556"
    assert d["lifecycle_state"] == "ON_HOLD" and "CARD_PAID_DUPLICATE" in codes(d)


def test_recurring_same_amount_not_auto_flagged(client):
    d = inv(client, "IN-EM-046-1")  # Cloudbarn INV-01568: same 2,520 monthly subscription
    assert d["lifecycle_state"] == "PENDING_APPROVAL"
    assert not d["duplicate_candidates"]


def test_at11_bank_change_hold_despite_matching_master(client):
    d = inv(client, "IN-EM-019-1")  # Cascadia 1625
    assert d["amount_minor"] == 605123 and d["remit"]["account_masked"] == "****9679"
    f = finding(d, "BANK_CHANGE_UNVERIFIED")
    assert f["blocking"] and not f["dismissible"] and f["data"]["bank_change_id"] == "BC-009"
    assert d["lifecycle_state"] == "ON_HOLD" and d["primary_action"]["kind"] == "review_bank_details"


def test_at35_scanned_cascadia_before_change_still_held(client):
    d = inv(client, "IN-EM-013-1")  # scan_8049.png dated 2026-10-24, before BC-009 (2026-10-27)
    assert d["invoice_date"] == "2026-10-24" and "BANK_CHANGE_UNVERIFIED" in codes(d)


def test_at21_p13_missing_po_hold(client):
    d = inv(client, "IN-EM-002-1")  # Keystone requires_po=yes
    f = finding(d, "PO_MISSING")
    assert f["blocking"] and f["policy_ids"] == ["P13"]


def test_at22_credit_note(client):
    d = inv(client, "IN-EM-042-1")  # Fixwell CN-FA-000413 −1,614.21
    assert d["kind"] == "credit_note" and d["amount_minor"] == -161421
    assert d["lifecycle_state"] == "CREDIT_RECORDED" and d["approval_chain"] == []
    assert "prepare_payment" not in d["allowed_actions"]
    v = client.get("/api/v1/vendors/V043", headers=H("U004")).json()
    assert v["credit_balance_minor"] == -161421
    assert d["anomaly"]["status"] == "NOT_SCORED"  # AT-34


def test_at23_usd_invoice_date_fx(client):
    d = inv(client, "IN-EM-021-1")  # Sparkgrid USD 1,950.00 dated 2026-10-26
    assert d["currency"] == "USD" and d["fx"]["date"] == "2026-10-26"
    from decimal import ROUND_HALF_UP, Decimal
    expected = (Decimal(1950) * Decimal(d["fx"]["rate"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    assert d["amount_cad_minor"] == int(expected * 100)  # thresholds use this CAD amount


def test_at32_lattice_unusual_amount_from_code(client):
    d = inv(client, "IN-EM-041-1")
    a = d["anomaly"]
    assert a["band"] == "high" and a["inputs"]["history_count"] == 8
    f = finding(d, "AMOUNT_UNUSUAL")
    assert not f["blocking"]  # advisory only: never creates a hold by itself
    assert "6.4×" in f["rationale"] and "1,386.00" in f["rationale"] and "1,491.60" in f["rationale"]


def test_at33_queen_street_fixed_rent_not_unusual(client):
    d = inv(client, "IN-EM-044-1")
    assert d["anomaly"]["status"] == "SCORED" and float(d["anomaly"]["score"]) == 0.0
    assert "AMOUNT_UNUSUAL" not in codes(d, blocking_only=False)


def test_at48_sparse_history_shows_uncertainty(client):
    d = inv(client, "IN-EM-001-1")  # Blue Heron: unknown supplier, no history
    a = d["anomaly"]
    assert a["status"] == "INSUFFICIENT_HISTORY"  # no amount score is fabricated
    assert a["inputs"]["amount_component"]["score"] == "0" and "Limited supplier history" in \
        finding(d, "AMOUNT_HISTORY")["rationale"]
    assert [s["signal"] for s in a["signals"]] == ["unknown_supplier"]  # identity signal shown separately
    d = inv(client, "IN-EM-002-1")  # Keystone: known supplier with < 5 prior invoices, no identity signal
    assert d["anomaly"]["status"] == "INSUFFICIENT_HISTORY" and d["risk_band"] == "insufficient_history"


def test_duplicate_vendor_identity_lookalike_held(client):
    d = inv(client, "IN-EM-026-1")  # "Harlow and Stern LLP" V052 (no history) vs V026
    assert "DUPLICATE_VENDOR_IDENTITY" in codes(d)
    d2 = inv(client, "IN-EM-008-1")  # invoice from established V026: warning only
    assert "DUPLICATE_VENDOR_IDENTITY" in codes(d2, blocking_only=False)
    assert "DUPLICATE_VENDOR_IDENTITY" not in codes(d2)


def test_at20_legal_vendor_fm_once_with_p02_p06(client):
    d = inv(client, "IN-EM-018-1")  # Harlow & Stern (Legal) 16,131.94
    fm = [s for s in d["approval_chain"] if s["step_key"] == "finance_manager"]
    assert len(fm) == 1 and fm[0]["trigger_policy_ids"] == ["P02", "P06"]


def test_at19_queen_street_facilities_delegate_collision(client):
    d = inv(client, "IN-EM-044-1")  # Facilities (U012 on leave → U003) and > 10k
    dept = d["approval_chain"][0]
    assert dept["assigned_actor_id"] == "U002" and "P08" in dept["trigger_policy_ids"]
    assert d["approval_chain"][1]["assigned_actor_id"] == "U003"
    assert d["eligible_releasers"] == ["U001"]


def test_at38_revalidation_is_deterministic(client):
    a = inv(client, "IN-EM-041-1")
    r = client.post("/api/v1/invoices/IN-EM-041-1/validate", headers=H("U004"),
                    json={"expected_version": a["version"]})
    assert r.status_code == 200
    b = r.json()
    strip = lambda d: sorted((f["code"], f["result"], f["blocking"], f["rationale"]) for f in d["validation_findings"])  # noqa: E731
    assert strip(a) == strip(b) and a["anomaly"]["score"] == b["anomaly"]["score"]
