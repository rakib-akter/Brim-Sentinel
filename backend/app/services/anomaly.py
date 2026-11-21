"""AnomalyService — P1 per PRD v1.4 A4: robust log-amount median/MAD, as-of evaluation,
evidence-backed explanation, risk-sorted queue.

Advisory only: the output is a REVIEW PRIORITY, not a fraud probability, and never creates or
clears a payment hold. The supplied `anomaly.py` (P2: empirical-Bayes shrinkage, grouped noisy-OR)
is not present in this repository and is not claimed.

Method (METHOD_VERSION):
  history = this supplier's invoices with positive totals, invoice_date strictly before the scored
            invoice's date (as-of; no look-ahead), excluding the scored invoice, credit notes and
            rejected/cancelled invoices. CAD amounts.
  n < 5   → INSUFFICIENT_HISTORY (no score is fabricated)
  z       = 0.6745 × (ln(amount) − median(ln h)) / max(MAD(ln h), 0.04)
  score   = 0 if |z| ≤ 3 else 1 − exp(−(|z| − 3)/3)   (hand-set; documented; smaller-than-usual × 0.35)
  band    = high ≥ 0.60, medium ≥ 0.30, else low"""
from __future__ import annotations

import math
import statistics
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import fmt
from app.db.models import AnomalyResult, Invoice, InvoiceVersion

METHOD_VERSION = "robust_mad_v1"
MIN_HISTORY = 5
MAD_FLOOR = 0.04
SMALL_BILL_WEIGHT = 0.35


def score_amount(amount_minor: int, history_minor: list[int]) -> dict[str, Any]:
    if amount_minor is None or amount_minor <= 0:
        return {"status": "NOT_SCORED", "band": "none", "score": "0", "reason": "Credit note or non-positive total."}
    hist = [h for h in history_minor if h and h > 0]
    if len(hist) < MIN_HISTORY:
        return {"status": "INSUFFICIENT_HISTORY", "band": "insufficient_history", "score": "0", "n": len(hist),
                "reason": f"Limited supplier history ({len(hist)} prior invoices; {MIN_HISTORY} needed). "
                          f"No amount score is given."}
    logs = [math.log(h) for h in hist]
    med = statistics.median(logs)
    mad = statistics.median([abs(x - med) for x in logs])
    scale = max(mad, MAD_FLOOR)
    z = 0.6745 * (math.log(amount_minor) - med) / scale
    raw = 0.0 if abs(z) <= 3 else 1 - math.exp(-(abs(z) - 3) / 3)
    if z < 0:
        raw *= SMALL_BILL_WEIGHT
    s = round(raw, 4)
    band = "high" if s >= 0.60 else "medium" if s >= 0.30 else "low"
    usual = int(round(math.exp(med)))
    ratio = Decimal(amount_minor) / Decimal(usual)
    return {
        "status": "SCORED", "band": band, "score": str(s), "n": len(hist), "z": round(z, 2),
        "median_minor": usual, "min_minor": min(hist), "max_minor": max(hist), "mad_log": round(mad, 4),
        "ratio_to_usual": str(ratio.quantize(Decimal("0.1"))),
    }


def evaluate(session: Session, invoice: Invoice, version: InvoiceVersion) -> AnomalyResult:
    amount = version.amount_cad_minor
    hist: list[int] = []
    if invoice.vendor_id and version.invoice_date:
        rows = session.execute(
            select(InvoiceVersion.amount_cad_minor, InvoiceVersion.invoice_date, Invoice.lifecycle_state,
                   Invoice.kind, Invoice.id, InvoiceVersion.version, Invoice.current_version)
            .join(Invoice, Invoice.id == InvoiceVersion.invoice_id)
            .where(Invoice.vendor_id == invoice.vendor_id, Invoice.id != invoice.id,
                   InvoiceVersion.invoice_date < version.invoice_date)).all()
        hist = [r.amount_cad_minor for r in rows if r.version == r.current_version and r.kind == "invoice"
                and r.lifecycle_state not in {"REJECTED", "CANCELLED"} and r.amount_cad_minor]
    res = score_amount(amount if invoice.kind == "invoice" else -1, hist)
    signals = []
    if res["status"] == "SCORED" and res["band"] != "low":
        signals.append({
            "group": "amount", "signal": "amount_outlier", "strength": res["score"],
            "explanation": f"Unusual amount — {res['ratio_to_usual']}× the supplier's typical invoice "
                           f"{fmt(res['median_minor'])} (range {fmt(res['min_minor'])}–{fmt(res['max_minor'])} "
                           f"over {res['n']} invoices).",
        })
    ar = AnomalyResult(invoice_id=invoice.id, version=version.version, method_version=METHOD_VERSION,
                       as_of=version.invoice_date or "", band=res["band"], score=res["score"], status=res["status"],
                       inputs={"amount_cad_minor": amount, "history_count": len(hist),
                               "history_cad_minor": sorted(hist)}, signals=signals)
    session.add(ar)
    invoice.risk_band = res["band"]
    invoice.risk_score = res["score"]
    return ar
