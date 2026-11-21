"""AnomalyService — PRD v1.4 A4 / §5B: deterministic review priority.

Advisory only: the output is a REVIEW PRIORITY, not a fraud probability. It never creates or
clears a payment hold (hard blockers stay in ValidationService) and contains no randomness.

Method ``METHOD_VERSION``:

* **as_of** — every input must have been knowable at ``as_of``. Live scoring uses
  ``max(BRIM_AS_OF_DATE, today)``; backtests use the scored invoice's own date.
* **amount group** (P1): history = this supplier's positive-total invoices dated strictly before
  the scored invoice and no later than ``as_of`` (scored invoice, credit notes and rejected/
  cancelled invoices excluded; backtests use only the historical ledger). n < 5 →
  INSUFFICIENT_HISTORY (no score is fabricated).
  ``z = 0.6745 × (ln(amount) − median(ln h)) / max(MAD(ln h), 0.04)``;
  ``p = 0 if |z| ≤ 3 else 1 − exp(−(|z| − 3)/3)``; smaller-than-usual bills × 0.35.
* **identity group** (hand-set strengths, documented, not learned):
  unverified bank change requested between 60 days before the invoice and ``as_of`` = 0.70;
  remit-to account differs from vendor master = 0.60; look-alike vendor identity = 0.50;
  unknown supplier = 0.40. The remit, look-alike and unknown-supplier signals read the
  document/vendor master and are used only in live scoring (not as-of safe for backtests).
* **grouped noisy-OR**: keep the strongest signal per group, then
  ``risk = 1 − Π_g (1 − p_g)``. Correlated identity signals (look-alike name + new bank
  account) therefore count once (AT-37).
* **bands**: high ≥ 0.60, medium ≥ 0.30, low otherwise; ``insufficient_history`` when the
  amount cannot be scored and no other signal fired; ``none`` for credit notes."""
from __future__ import annotations

import datetime as dt
import math
import statistics
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.money import fmt
from app.db.models import AnomalyResult, Invoice, InvoiceVersion, Vendor, VendorBankChange

METHOD_VERSION = "robust_mad_grouped_noisy_or_v2"
MIN_HISTORY = 5
MAD_FLOOR = 0.04
SMALL_BILL_WEIGHT = 0.35
BANK_CHANGE_LOOKBACK_DAYS = 60
IDENTITY_WEIGHTS = {
    "unverified_bank_change": 0.70,
    "remit_account_differs_from_master": 0.60,
    "lookalike_vendor_identity": 0.50,
    "unknown_supplier": 0.40,
}


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


def band_for(score: float) -> str:
    return "high" if score >= 0.60 else "medium" if score >= 0.30 else "low"


def combine(amount: dict[str, Any], identity_signals: list[dict[str, Any]]) -> dict[str, Any]:
    """Pure grouped noisy-OR over the amount component and identity signals."""
    signals: list[dict[str, Any]] = []
    if amount["status"] == "SCORED" and float(amount["score"]) > 0:
        signals.append({
            "group": "amount", "signal": "amount_outlier", "strength": amount["score"],
            "explanation": f"Unusual amount — {amount['ratio_to_usual']}× the supplier's typical invoice "
                           f"{fmt(amount['median_minor'])} (range {fmt(amount['min_minor'])}–"
                           f"{fmt(amount['max_minor'])} over {amount['n']} invoices).",
        })
    signals.extend(identity_signals)
    groups: dict[str, float] = {}
    for s in signals:
        groups[s["group"]] = max(groups.get(s["group"], 0.0), float(s["strength"]))
    risk = 1.0
    for p in groups.values():
        risk *= 1 - p
    risk = round(1 - risk, 4)
    if amount["status"] == "NOT_SCORED":
        band = "none"
    elif amount["status"] == "INSUFFICIENT_HISTORY" and not identity_signals:
        band = "insufficient_history"
    else:
        band = band_for(risk)
    return {"score": str(risk), "band": band, "signals": signals,
            "groups": {g: round(p, 4) for g, p in sorted(groups.items())}}


# ----------------------------------------------------------------------------- inputs (as-of)
def live_as_of() -> str:
    return max(get_settings().as_of_date, dt.date.today().isoformat())


def amount_history(session: Session, *, vendor_id: str, invoice_id: str, invoice_date: str, as_of: str,
                   historical_only: bool = False) -> list[int]:
    stmt = (select(InvoiceVersion.amount_cad_minor, InvoiceVersion.version, Invoice.current_version, Invoice.kind,
                   Invoice.lifecycle_state, Invoice.source_kind)
            .join(Invoice, Invoice.id == InvoiceVersion.invoice_id)
            .where(Invoice.vendor_id == vendor_id, Invoice.id != invoice_id,
                   InvoiceVersion.invoice_date < invoice_date, InvoiceVersion.invoice_date <= as_of))
    if historical_only:
        stmt = stmt.where(Invoice.source_kind == "historical_ledger")
    return [r.amount_cad_minor for r in session.execute(stmt).all()
            if r.version == r.current_version and r.kind == "invoice"
            and r.lifecycle_state not in {"REJECTED", "CANCELLED"} and r.amount_cad_minor]


def _verified_on(bc: VendorBankChange) -> str | None:
    if bc.source == "dataset" and bc.verified_by_callback_source:
        return bc.requested_at  # dataset: verified by callback when recorded
    if bc.state in {"AUTHORIZED", "REVALIDATION_REQUIRED", "CLOSED"}:
        return (bc.authorized_at or bc.verification_occurred_at or bc.requested_at)[:10]
    return None


def bank_change_signals(session: Session, *, vendor_id: str, invoice_date: str, as_of: str) -> list[dict[str, Any]]:
    """Unverified bank changes knowable at as_of, requested from 60 days before the invoice
    onward (including after it: an unpaid invoice would go to the new account)."""
    lo = (dt.date.fromisoformat(invoice_date) - dt.timedelta(days=BANK_CHANGE_LOOKBACK_DAYS)).isoformat()
    out = []
    for bc in session.scalars(select(VendorBankChange).where(VendorBankChange.vendor_id == vendor_id)
                              .order_by(VendorBankChange.id)):
        if not (lo <= bc.requested_at <= as_of):
            continue
        verified = _verified_on(bc)
        if verified is not None and verified <= as_of:
            continue
        out.append({"group": "identity", "signal": "unverified_bank_change",
                    "strength": str(IDENTITY_WEIGHTS["unverified_bank_change"]), "ref": bc.id,
                    "explanation": f"Bank change {bc.id} requested {bc.requested_at} via {bc.request_channel} was not "
                                   f"independently verified as of {as_of}."})
    return out


def document_identity_signals(session: Session, invoice: Invoice, version: InvoiceVersion) -> list[dict[str, Any]]:
    from app.db.seed import account_fingerprint
    from app.services import vendors as vendor_svc

    out: list[dict[str, Any]] = []
    if invoice.vendor_id is None:
        out.append({"group": "identity", "signal": "unknown_supplier",
                    "strength": str(IDENTITY_WEIGHTS["unknown_supplier"]),
                    "explanation": f"Supplier '{version.vendor_name_raw}' is not in the vendor master."})
        return out
    vendor = session.get(Vendor, invoice.vendor_id)
    fp = (version.remit or {}).get("account_fingerprint")
    if vendor is not None and fp and vendor.bank_account:
        master = account_fingerprint(vendor.bank_institution, vendor.bank_transit, vendor.bank_account)
        if fp != master:
            out.append({"group": "identity", "signal": "remit_account_differs_from_master",
                        "strength": str(IDENTITY_WEIGHTS["remit_account_differs_from_master"]),
                        "explanation": f"Remit-to account ****{(version.remit or {}).get('account_last4')} differs "
                                       f"from the vendor master account ****{vendor.bank_account[-4:]}."})
    if vendor is not None:
        look = [x for x in vendor_svc.similar_identities(session, vendor)]
        if look:
            out.append({"group": "identity", "signal": "lookalike_vendor_identity",
                        "strength": str(IDENTITY_WEIGHTS["lookalike_vendor_identity"]),
                        "explanation": "Vendor name resembles "
                                       + ", ".join(f"{x['vendor_id']} {x['legal_name']}" for x in look[:3]) + "."})
    return out


# ----------------------------------------------------------------------------- entry points
def score(session: Session, invoice: Invoice, version: InvoiceVersion, *, as_of: str,
          backtest: bool = False) -> dict[str, Any]:
    """Compute (without persisting) the priority of one invoice version as of a date."""
    amount = version.amount_cad_minor
    hist: list[int] = []
    identity: list[dict[str, Any]] = []
    if invoice.vendor_id and version.invoice_date:
        hist = amount_history(session, vendor_id=invoice.vendor_id, invoice_id=invoice.id,
                              invoice_date=version.invoice_date, as_of=as_of, historical_only=backtest)
        identity += bank_change_signals(session, vendor_id=invoice.vendor_id, invoice_date=version.invoice_date,
                                        as_of=as_of)
    if not backtest and invoice.kind == "invoice":
        identity += document_identity_signals(session, invoice, version)
    amt = score_amount(amount if invoice.kind == "invoice" else -1, hist)
    if invoice.kind != "invoice":
        identity = []  # credit notes are matched by rule, not scored
    res = combine(amt, identity)
    return {**res, "status": amt["status"], "as_of": as_of, "method_version": METHOD_VERSION,
            "amount_component": amt,
            "inputs": {"amount_cad_minor": amount, "history_count": len(hist), "history_cad_minor": sorted(hist),
                       "invoice_date": version.invoice_date, "as_of": as_of, "backtest": backtest,
                       "identity_weights": IDENTITY_WEIGHTS, "groups": res["groups"]}}


def evaluate(session: Session, invoice: Invoice, version: InvoiceVersion) -> AnomalyResult:
    res = score(session, invoice, version, as_of=live_as_of())
    ar = AnomalyResult(invoice_id=invoice.id, version=version.version, method_version=METHOD_VERSION,
                       as_of=res["as_of"], band=res["band"], score=res["score"], status=res["status"],
                       inputs={**res["inputs"], "amount_component": res["amount_component"]}, signals=res["signals"])
    session.add(ar)
    invoice.risk_band = res["band"]
    invoice.risk_score = res["score"]
    return ar


def amount_signal(ar: AnomalyResult) -> dict[str, Any] | None:
    return next((s for s in ar.signals or [] if s.get("signal") == "amount_outlier"), None)
