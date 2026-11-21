"""Reproducible anomaly evaluation (PRD §5B, AT-36/37/39).

1. **No-look-ahead backtest** over every historical-ledger invoice: each one is scored with
   ``as_of`` = its own invoice date, using only ledger invoices dated strictly earlier and bank
   changes requested on or before that date.
2. **Injection experiment** (fixed seed): sample historical invoices that have ≥ 5 prior
   invoices, plant one synthetic anomaly per type into a copy of each and score it as-of the
   original date. Catch = band medium/high. The false-alarm rate is the share of the same
   *unmodified* sampled invoices that are medium/high.

Results are synthetic-injection detection rates on a synthetic dataset — not real-world fraud
recall. Output: ``docs/eval/anomaly_eval.json`` (method version, seed and dataset hashes).

Run:  python -m scripts.evaluate_anomaly [--seed 20261121] [--sample 200] [--out PATH]
      (seeds a throw-away SQLite copy of the dataset unless --use-current-db is given)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import BACKEND_DIR, get_settings
from app.services import anomaly

DEFAULT_SEED = 20261121
INJECTIONS: dict[str, dict[str, Any]] = {
    "amount_x2": {"factor": 2.0},
    "amount_x3": {"factor": 3.0},
    "amount_x5": {"factor": 5.0},
    "amount_x0_2_small_bill": {"factor": 0.2},
    "unverified_bank_change": {"identity": ["unverified_bank_change"]},
    "lookalike_and_bank_change_together": {"identity": ["unverified_bank_change", "lookalike_vendor_identity"]},
}


def _identity(names: list[str]) -> list[dict[str, Any]]:
    return [{"group": "identity", "signal": n, "strength": str(anomaly.IDENTITY_WEIGHTS[n]),
             "explanation": f"injected {n}"} for n in names]


def _ledger(session: Session) -> list[tuple[Any, Any]]:
    from app.db.models import Invoice, InvoiceVersion

    rows = session.execute(
        select(Invoice, InvoiceVersion).join(InvoiceVersion, (InvoiceVersion.invoice_id == Invoice.id)
                                             & (InvoiceVersion.version == Invoice.current_version))
        .where(Invoice.source_kind == "historical_ledger").order_by(InvoiceVersion.invoice_date, Invoice.id)).all()
    return [(r[0], r[1]) for r in rows]


def backtest(session: Session) -> dict[str, Any]:
    bands: Counter[str] = Counter()
    scored = []
    for inv, v in _ledger(session):
        r = anomaly.score(session, inv, v, as_of=v.invoice_date, backtest=True)
        bands[r["band"]] += 1
        scored.append({"invoice_id": inv.id, "vendor_id": inv.vendor_id, "invoice_date": v.invoice_date,
                       "amount_cad_minor": v.amount_cad_minor, "score": r["score"], "band": r["band"],
                       "signals": [s["signal"] for s in r["signals"]]})
    top = sorted(scored, key=lambda x: (-float(x["score"]), x["invoice_id"]))[:10]
    return {"invoices": len(scored), "bands": dict(sorted(bands.items())), "top_10": top,
            "bank_change_signals": sum("unverified_bank_change" in s["signals"] for s in scored)}


def injection_experiment(session: Session, seed: int, sample_size: int) -> dict[str, Any]:
    eligible = []
    for inv, v in _ledger(session):
        if inv.kind != "invoice" or not v.amount_cad_minor or v.amount_cad_minor <= 0 or not inv.vendor_id:
            continue
        hist = anomaly.amount_history(session, vendor_id=inv.vendor_id, invoice_id=inv.id,
                                      invoice_date=v.invoice_date, as_of=v.invoice_date, historical_only=True)
        if len(hist) >= anomaly.MIN_HISTORY:
            eligible.append((inv.id, v.amount_cad_minor, hist))
    rng = random.Random(seed)
    sample = rng.sample(eligible, min(sample_size, len(eligible)))
    flagged = {"medium", "high"}
    base_flags = 0
    caught: Counter[str] = Counter()
    grouped_once = True
    for _iid, amount, hist in sample:
        base = anomaly.combine(anomaly.score_amount(amount, hist), [])
        base_flags += base["band"] in flagged
        bank_only = None
        for name, spec in INJECTIONS.items():
            amt = int(round(amount * spec.get("factor", 1.0)))
            res = anomaly.combine(anomaly.score_amount(amt, hist), _identity(spec.get("identity", [])))
            caught[name] += res["band"] in flagged
            if name == "unverified_bank_change":
                bank_only = res["score"]
            if name == "lookalike_and_bank_change_together" and res["score"] != bank_only:
                grouped_once = False
    n = len(sample)
    return {
        "seed": seed, "eligible_invoices": len(eligible), "sample_size": n,
        "false_alarm_rate_unmodified": round(base_flags / n, 4) if n else None,
        "false_alarms_unmodified": base_flags,
        "catch_rate": {k: round(caught[k] / n, 4) for k in INJECTIONS} if n else {},
        "definition": "catch = band medium/high on the injected copy; false alarm = band medium/high on the same "
                      "unmodified sampled invoice (as-of its own date)",
        "at37_correlated_identity_counted_once": grouped_once,
    }


def run(session: Session, seed: int = DEFAULT_SEED, sample_size: int = 200) -> dict[str, Any]:
    from app.ml.coding_model import file_sha256

    data = get_settings().data_dir / "data"
    return {
        "method_version": anomaly.METHOD_VERSION,
        "evaluated_at": dt.date.today().isoformat(),
        "dataset_sha256": {n: file_sha256(data / n) for n in ("invoices.csv", "bank_change_history.csv")},
        "parameters": {"min_history": anomaly.MIN_HISTORY, "mad_floor": anomaly.MAD_FLOOR,
                       "small_bill_weight": anomaly.SMALL_BILL_WEIGHT, "identity_weights": anomaly.IDENTITY_WEIGHTS,
                       "bank_change_lookback_days": anomaly.BANK_CHANGE_LOOKBACK_DAYS},
        "backtest_no_look_ahead": backtest(session),
        "injection_experiment": injection_experiment(session, seed, sample_size),
        "caveats": ["Synthetic dataset and synthetic injections: these are detection rates for planted anomalies, "
                    "not real-world fraud recall or precision.",
                    "Identity strengths are hand-set and documented; the score is a review priority, not a probability.",
                    "Backtests use only as-of-safe signals (amount history, bank-change dates)."],
    }


def _seed_temp_db() -> tempfile.TemporaryDirectory:
    from app.core.config import reset_settings
    from app.db.seed import run_seed
    from app.db.session import init_db, reset_engine, session_scope

    tmp = tempfile.TemporaryDirectory()
    os.environ["DATABASE_URL"] = f"sqlite:///{Path(tmp.name) / 'eval.db'}"
    os.environ["BRIM_UPLOAD_DIR"] = str(Path(tmp.name) / "uploads")
    reset_settings()
    reset_engine()
    init_db()
    with session_scope() as s:
        run_seed(s)
    return tmp


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--sample", type=int, default=200)
    ap.add_argument("--out", default=str(BACKEND_DIR / "docs" / "eval" / "anomaly_eval.json"))
    ap.add_argument("--use-current-db", action="store_true")
    args = ap.parse_args()
    tmp = None if args.use_current_db else _seed_temp_db()
    from app.db.session import new_session

    s = new_session()
    try:
        res = run(s, args.seed, args.sample)
    finally:
        s.close()
        if tmp is not None:
            tmp.cleanup()
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(res, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"backtest": {k: v for k, v in res["backtest_no_look_ahead"].items() if k != "top_10"},
                      "injection": res["injection_experiment"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
