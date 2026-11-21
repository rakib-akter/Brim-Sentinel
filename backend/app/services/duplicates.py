"""DuplicateService (FR-05, §6.1): staged, deterministic matching.

 1. EXACT — same vendor + same normalized invoice number (confirmed duplicate)
 2. NORMALIZED_NUMBER — same vendor, reformatted number with the same numeric core (candidate)
 3. ALIAS_VENDOR — look-alike vendor record with same numeric core, or same amount within 30 days
 4. NEAR — same vendor, currency and total within 31 days, different number (candidate);
    recurring fixed-fee billing (≥3 prior invoices with the same total) is NOT auto-flagged
 5. CARD_PAID — Brim card transaction for this invoice (memo-linked) or an unlinked card charge
    with matching merchant descriptor, amount and date window (candidate)
RapidFuzz generates candidates only; it never confirms a duplicate on its own."""
from __future__ import annotations

import datetime as dt
import re
from collections import Counter
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import fmt
from app.db.models import CardTransaction, Invoice, InvoiceVersion, Payment, Vendor
from app.services import vendors as vendor_svc
from app.services.validation import Result, _ev

_MEMO_RE = re.compile(r"AP payment (AP-\d+)")


def digit_core(num: str | None) -> str | None:
    if not num:
        return None
    digits = re.sub(r"\D", "", num)
    return digits.lstrip("0") or ("0" if digits else None)


def _days(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    return abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days)


def _current_versions(session: Session, exclude_id: str) -> list[tuple[Invoice, InvoiceVersion]]:
    rows = session.execute(
        select(Invoice, InvoiceVersion).join(InvoiceVersion, (InvoiceVersion.invoice_id == Invoice.id)
                                             & (InvoiceVersion.version == Invoice.current_version))
        .where(Invoice.id != exclude_id, Invoice.lifecycle_state != "CANCELLED")).all()
    return [(r[0], r[1]) for r in rows]


def _paid_note(session: Session, inv: Invoice) -> str:
    p = session.scalar(select(Payment).where(Payment.invoice_id == inv.id).order_by(Payment.created_at.desc()))
    if p is None:
        return f"status {inv.historical_status or inv.lifecycle_state}"
    return f"paid via {p.method} {p.reference or p.id} ({p.historical_status or p.state})"


def find(session: Session, invoice: Invoice, version: InvoiceVersion) -> tuple[list[dict[str, Any]], list[Result]]:
    candidates: list[dict[str, Any]] = []
    results: list[Result] = []
    vendor = session.get(Vendor, version.vendor_id) if version.vendor_id else None
    alias_ids = {s["vendor_id"] for s in vendor_svc.similar_identities(session, vendor)} if vendor else set()
    my_core = digit_core(version.invoice_number_raw)
    pool = _current_versions(session, invoice.id)
    same_vendor_totals = Counter(v.total_minor for i, v in pool if vendor and i.vendor_id == vendor.id)

    for other, ov in pool:
        if other.kind != invoice.kind:
            continue  # credit notes reference invoices; they are not duplicates of them
        reasons: list[str] = []
        mtype = None
        score = 0
        confirmed = False
        same_vendor = vendor is not None and other.vendor_id == vendor.id
        alias_vendor = other.vendor_id in alias_ids
        d = _days(version.invoice_date, ov.invoice_date)
        if same_vendor and version.invoice_number_norm and ov.invoice_number_norm == version.invoice_number_norm:
            mtype, score, confirmed = "EXACT", 100, True
            reasons.append(f"Same vendor and invoice number {ov.invoice_number_raw}")
        elif (same_vendor or alias_vendor) and my_core and digit_core(ov.invoice_number_raw) == my_core:
            mtype, score = ("NORMALIZED_NUMBER", 90) if same_vendor else ("ALIAS_VENDOR", 85)
            reasons.append(f"Invoice number {version.invoice_number_raw} ≈ {ov.invoice_number_raw} (same numeric core "
                           f"{my_core})" + ("" if same_vendor else f" from look-alike vendor {other.vendor_id}"))
        elif (same_vendor or alias_vendor) and version.total_minor is not None and ov.total_minor == version.total_minor \
                and ov.currency == version.currency and d is not None and d <= 31:
            recurring = same_vendor and same_vendor_totals.get(version.total_minor, 0) >= 3
            if not recurring:
                mtype, score = ("NEAR", 80) if same_vendor else ("ALIAS_VENDOR", 75)
                reasons.append(f"Same total {fmt(version.total_minor, version.currency or 'CAD')} within {d} days")
        if mtype is None:
            continue
        if version.total_minor is not None and ov.total_minor == version.total_minor:
            reasons.append("Same total amount")
        if d is not None:
            reasons.append(f"Invoice dates {d} days apart ({ov.invoice_date})")
        reasons.append(f"Matched record {other.id} ({other.source_kind}): {_paid_note(session, other)}")
        candidates.append({"match_type": mtype, "confirmed": confirmed, "score": score,
                           "matched_invoice_id": other.id, "matched_card_txn_id": None, "reasons": reasons})

    # Brim card-paid detection.
    if vendor is not None and version.invoice_date:
        nn = vendor_svc.normalize_name(vendor.legal_name).upper()
        inv_date = dt.date.fromisoformat(version.invoice_date)
        lo, hi = (inv_date - dt.timedelta(days=30)).isoformat(), (inv_date + dt.timedelta(days=60)).isoformat()
        my_hist_ids = {i.id for i, v in pool if i.vendor_id == vendor.id and my_core
                       and digit_core(v.invoice_number_raw) == my_core}
        for tx in session.scalars(select(CardTransaction)):
            desc = vendor_svc.normalize_name(tx.merchant_descriptor).upper()
            name_score = max(fuzz.partial_ratio(desc, nn), fuzz.token_set_ratio(desc, nn))
            if name_score < 85:
                continue
            memo = _MEMO_RE.search(tx.memo or "")
            if memo and memo.group(1) in my_hist_ids:
                candidates.append({"match_type": "CARD_PAID", "confirmed": False, "score": 95,
                                   "matched_invoice_id": memo.group(1), "matched_card_txn_id": tx.id,
                                   "reasons": [f"Brim card {tx.card_id} charge {tx.id} on {tx.posted_date} "
                                               f"({fmt(tx.amount_minor, tx.currency)}) paid {memo.group(1)}, which has "
                                               f"the same invoice number core {my_core}",
                                               f"Descriptor '{tx.merchant_descriptor}' ~ vendor (score {name_score})"]})
                continue
            if memo:
                continue  # charge already reconciled to a different invoice
            same_amt = (tx.currency == version.currency and tx.amount_minor == version.total_minor) or \
                       (version.amount_cad_minor is not None and tx.amount_cad_minor == version.amount_cad_minor)
            if same_amt and lo <= tx.posted_date <= hi:
                candidates.append({"match_type": "CARD_PAID", "confirmed": False, "score": 80,
                                   "matched_invoice_id": None, "matched_card_txn_id": tx.id,
                                   "reasons": [f"Card charge {tx.id} by {tx.cardholder_user_id} on {tx.posted_date} for "
                                               f"{fmt(tx.amount_minor, tx.currency)} at '{tx.merchant_descriptor}' "
                                               f"(descriptor score {name_score})",
                                               f"Receipt attached: {'yes' if tx.receipt_attached else 'no'}",
                                               "Descriptor match is a candidate, not proof"]})

    for c in candidates:
        code = ("DUPLICATE_INVOICE" if c["confirmed"] else
                "CARD_PAID_DUPLICATE" if c["match_type"] == "CARD_PAID" else "DUPLICATE_CANDIDATE")
        subj = c["matched_card_txn_id"] or c["matched_invoice_id"] or ""
        ev = []
        if c["matched_invoice_id"]:
            ev.append(_ev("invoice", c["matched_invoice_id"]))
        if c["matched_card_txn_id"]:
            ev.append(_ev("card_transaction", c["matched_card_txn_id"]))
        results.append(Result("duplicates", code, "FAIL", True, "; ".join(c["reasons"]) + ".",
                              "high" if c["score"] >= 90 else "medium", evidence=ev,
                              data={"match_type": c["match_type"], "score": c["score"]}, subject=subj))
    if not candidates:
        results.append(Result("duplicates", "DUPLICATES", "PASS", False,
                              "No exact, reformatted, near, look-alike-vendor or card-paid matches."))
    return candidates, results
