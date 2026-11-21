"""Anomaly priority: as-of / no-look-ahead semantics, grouped noisy-OR and the reproducible
evaluation (AT-35, AT-36, AT-37, AT-38, AT-39). Advisory only — never a hold by itself."""
from __future__ import annotations

from app.db.models import Invoice, InvoiceVersion
from app.services import anomaly
from scripts import evaluate_anomaly
from tests.conftest import H, codes, finding, inv


def _ledger(session, iid):
    i = session.get(Invoice, iid)
    v = session.query(InvoiceVersion).filter_by(invoice_id=iid, version=i.current_version).one()
    return i, v


def test_at36_backtest_ap00173_has_no_bank_change_signal(session):
    i, v = _ledger(session, "AP-00173")  # Cascadia, paid 2026-04-26 — six months before BC-009
    back = anomaly.score(session, i, v, as_of=v.invoice_date, backtest=True)
    assert "unverified_bank_change" not in [s["signal"] for s in back["signals"]]
    assert back["inputs"]["as_of"] == "2026-04-26"
    # Live scoring (as-of the dataset date) of the same vendor's open invoice does see BC-009.
    i2, v2 = _ledger(session, "IN-EM-019-1")
    live = anomaly.score(session, i2, v2, as_of=anomaly.live_as_of())
    assert "unverified_bank_change" in [s["signal"] for s in live["signals"]]


def test_at35_scanned_1624_raises_bank_change_signal_and_stays_held(client):
    d = inv(client, "IN-EM-013-1")  # scan_8049.png dated 2026-10-24, BC-009 requested 2026-10-27
    sig = next(s for s in d["anomaly"]["signals"] if s["signal"] == "unverified_bank_change")
    assert sig["ref"] == "BC-009" and d["anomaly"]["band"] == "high"
    assert "BANK_CHANGE_UNVERIFIED" in codes(d)  # the hold comes from the rule, not the score


def test_future_invoices_never_change_a_backtest_score(session):
    i, v = _ledger(session, "AP-00347")
    before = anomaly.score(session, i, v, as_of=v.invoice_date, backtest=True)
    # Plant a huge invoice for the same supplier dated AFTER the scored one.
    session.add(Invoice(id="AP-FUTURE", source_kind="historical_ledger", kind="invoice", lifecycle_state="SETTLED",
                        current_version=1, vendor_id=i.vendor_id))
    session.add(InvoiceVersion(invoice_id="AP-FUTURE", version=1, created_by="test", reason="look-ahead probe",
                               provenance="dataset_csv", invoice_date="2026-10-01", amount_cad_minor=99_999_999,
                               total_minor=99_999_999, currency="CAD"))
    session.flush()
    after = anomaly.score(session, i, v, as_of=v.invoice_date, backtest=True)
    assert after == before
    # Control: the same invoice dated BEFORE the scored one does enter the history.
    session.get(InvoiceVersion, session.query(InvoiceVersion.id).filter_by(invoice_id="AP-FUTURE").scalar()) \
        .invoice_date = "2026-01-02"
    session.flush()
    assert anomaly.score(session, i, v, as_of=v.invoice_date, backtest=True)["inputs"]["history_count"] == \
        before["inputs"]["history_count"] + 1


def test_bank_change_requested_after_as_of_is_invisible(client, session):
    r = client.post("/api/v1/vendors/V024/bank-change-requests", headers=H("U004"),
                    json={"institution": "001", "transit": "12345", "account": "987654321",
                          "request_channel": "email_request"})
    assert r.status_code == 200
    live = inv(client, "IN-EM-024-1")
    assert "unverified_bank_change" in [s["signal"] for s in live["anomaly"]["signals"]]
    hist = session.query(Invoice).filter_by(vendor_id="V024", source_kind="historical_ledger").order_by(
        Invoice.id.desc()).first()
    i, v = _ledger(session, hist.id)
    back = anomaly.score(session, i, v, as_of=v.invoice_date, backtest=True)
    assert "unverified_bank_change" not in [s["signal"] for s in back["signals"]]


def test_at37_correlated_identity_signals_count_once():
    amt = anomaly.score_amount(150000, [140000, 142000, 145000, 147000, 149000, 151000])
    bank = [{"group": "identity", "signal": "unverified_bank_change", "strength": "0.7", "explanation": "x"}]
    both = bank + [{"group": "identity", "signal": "lookalike_vendor_identity", "strength": "0.5", "explanation": "y"}]
    assert anomaly.combine(amt, both)["score"] == anomaly.combine(amt, bank)["score"] == "0.7"
    assert anomaly.combine(amt, both)["groups"] == {"identity": 0.7}
    big = anomaly.score_amount(900000, [140000, 142000, 145000, 147000, 149000, 151000])
    combined = float(anomaly.combine(big, bank)["score"])
    assert combined == round(1 - (1 - float(big["score"])) * (1 - 0.7), 4)  # independent groups combine


def test_anomaly_is_advisory_only(client):
    d = inv(client, "IN-EM-041-1")  # Lattice 557: high priority from the amount
    f = finding(d, "AMOUNT_UNUSUAL")
    assert not f["blocking"] and d["anomaly"]["band"] == "high"
    assert d["anomaly"]["method_version"] == anomaly.METHOD_VERSION


def test_at38_at39_evaluation_is_reproducible(session):
    a = evaluate_anomaly.injection_experiment(session, seed=7, sample_size=60)
    b = evaluate_anomaly.injection_experiment(session, seed=7, sample_size=60)
    assert a == b
    assert a["at37_correlated_identity_counted_once"] is True
    assert a["catch_rate"]["unverified_bank_change"] == 1.0
    assert a["catch_rate"]["amount_x5"] >= a["catch_rate"]["amount_x2"]
    bt = evaluate_anomaly.backtest(session)
    assert bt["invoices"] == 426 and bt["bank_change_signals"] == 0  # BC-009 post-dates every ledger invoice
