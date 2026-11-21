"""ValidationService (FR-04): deterministic checks over an immutable invoice version.

Each check yields typed results PASS | FAIL | UNKNOWN | NOT_APPLICABLE with evidence, rationale,
next action and a blocking flag. UNKNOWN is never treated as PASS: unknowns that affect a hard
gate are blocking. Money comparisons use integer minor units / Decimal only."""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.money import convert_to_cad_minor, fmt, from_minor, to_minor
from app.db.models import (
    Contract,
    FxRate,
    Invoice,
    InvoiceLine,
    InvoiceVersion,
    PaymentRoute,
    PurchaseOrder,
    User,
    Vendor,
    VendorBankChange,
)
from app.services import vendors as vendor_svc

OPEN_BANK_CHANGE_STATES = {"REQUESTED", "PENDING_INDEPENDENT_VERIFICATION", "VERIFICATION_RECORDED",
                           "PENDING_ROUTE_AUTHORIZATION"}
LINE_TOLERANCE_MINOR = 1  # qty × unit price rounding tolerance (1 cent); sums must reconcile exactly
TAX_TOLERANCE_MINOR = 1


@dataclass
class Result:
    check: str
    code: str
    result: str
    blocking: bool
    rationale: str
    severity: str = "info"
    evidence: list[dict[str, Any]] = field(default_factory=list)
    policy_ids: list[str] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)
    subject: str = ""  # dismissal key (e.g. matched record id)


def _ev(kind: str, ref: str, label: str | None = None, **extra: Any) -> dict[str, Any]:
    d = {"type": kind, "ref": ref}
    if label:
        d["label"] = label
    d.update(extra)
    return d


def _pass(check: str, code: str, rationale: str, **kw: Any) -> Result:
    return Result(check, code, "PASS", False, rationale, **kw)


def apply_fx(session: Session, version: InvoiceVersion) -> Result:
    if version.currency == "CAD":
        version.fx_rate, version.fx_date = "1", version.invoice_date
        version.amount_cad_minor = version.total_minor
        return _pass("currency_fx", "FX", "CAD invoice; no conversion needed.")
    if version.currency == "USD":
        if not version.invoice_date:
            version.amount_cad_minor = None
            return Result("currency_fx", "FX_RATE_MISSING", "UNKNOWN", True,
                          "Invoice date unknown, so the invoice-date USD→CAD rate cannot be chosen.", "high")
        rate = session.get(FxRate, version.invoice_date)
        if rate is None:
            version.amount_cad_minor = None
            version.fx_rate = None
            return Result("currency_fx", "FX_RATE_MISSING", "UNKNOWN", True,
                          f"No USD→CAD rate on file for {version.invoice_date}.", "high",
                          evidence=[_ev("fx_rates", version.invoice_date)])
        version.fx_rate, version.fx_date = rate.usd_to_cad, rate.date
        version.amount_cad_minor = (convert_to_cad_minor(version.total_minor, Decimal(rate.usd_to_cad))
                                    if version.total_minor is not None else None)
        return _pass("currency_fx", "FX",
                     f"USD converted at {rate.usd_to_cad} (fx_rates.csv, {rate.date}) = "
                     f"{fmt(version.amount_cad_minor)}. Thresholds evaluated in CAD.",
                     evidence=[_ev("fx_rates", rate.date, f"USD→CAD {rate.usd_to_cad}")],
                     data={"rate": rate.usd_to_cad, "date": rate.date, "amount_cad_minor": version.amount_cad_minor})
    version.amount_cad_minor = None
    return Result("currency_fx", "CURRENCY_UNSUPPORTED", "UNKNOWN", True,
                  f"Currency {version.currency!r} is not supported.", "high")


def _expected_taxes(province: str | None, vendor: Vendor | None, line_types: set[str]) -> tuple[dict[str, Decimal], list[str]]:
    """Return expected tax kinds → rate, plus notes about unverifiable parts."""
    notes: list[str] = []
    if vendor is not None and (vendor.country or "CA") != "CA":
        return {}, ["Foreign supplier: no Canadian tax expected (FOREIGN)."]
    if vendor is not None and (vendor.category or "").lower() == "insurance":
        return {}, ["Insurance premiums are exempt (EXEMPT)."]
    if province == "ON":
        return {"HST": Decimal("0.13")}, notes
    if province == "QC":
        return {"GST": Decimal("0.05"), "QST": Decimal("0.09975")}, notes
    if province == "BC":
        exp = {"GST": Decimal("0.05")}
        if line_types == {"goods"}:
            exp["PST"] = Decimal("0.07")
        elif not line_types:
            notes.append("BC PST applies to goods only and line type is unknown.")
        elif "goods" in line_types:
            notes.append("Mixed goods/services lines: BC PST base not determinable from the invoice.")
        return exp, notes
    if province in {"AB", "NT", "NU", "YT"}:
        return {"GST": Decimal("0.05")}, notes
    if province is None:
        return {}, ["Delivery province unknown."]
    return {"GST": Decimal("0.05")}, [f"Provincial tax rules for {province} are not configured in the dataset."]


def check_tax(version: InvoiceVersion, vendor: Vendor | None, lines: list[InvoiceLine]) -> Result:
    if version.subtotal_minor is None:
        return Result("tax", "TAX_UNVERIFIABLE", "UNKNOWN", True, "Subtotal unknown; tax cannot be verified.", "medium")
    line_types = {ln.line_type for ln in lines if ln.line_type}
    expected, notes = _expected_taxes(version.ship_to_province, vendor, line_types)
    if version.ship_to_province is None and (vendor is None or (vendor.country or "CA") == "CA"):
        return Result("tax", "TAX_UNVERIFIABLE", "UNKNOWN", True,
                      "Delivery (bill-to) province could not be read; tax treatment is unknown, not assumed zero.",
                      "medium")
    charged: dict[str, int] = {}
    for t in version.taxes or []:
        kind = (t.get("kind") or "").upper()
        if kind in {"GST/HST"}:
            kind = "GST"
        charged[kind] = charged.get(kind, 0) + (t.get("amount_minor") or 0)
    problems: list[str] = []
    detail: dict[str, Any] = {"province": version.ship_to_province, "expected": {}, "charged": charged}
    for kind, rate in expected.items():
        exp_minor = to_minor((from_minor(version.subtotal_minor) * rate).quantize(Decimal("0.01"), ROUND_HALF_UP))
        detail["expected"][kind] = {"rate": str(rate), "amount_minor": exp_minor}
        got = charged.get(kind)
        if got is None:
            problems.append(f"{kind} {rate * 100:.3f}% expected for {version.ship_to_province} "
                            f"({fmt(exp_minor, version.currency or 'CAD')}) but not charged")
        elif abs(got - exp_minor) > TAX_TOLERANCE_MINOR:
            problems.append(f"{kind} charged {fmt(got, version.currency or 'CAD')}, expected "
                            f"{fmt(exp_minor, version.currency or 'CAD')} at {rate * 100:.3f}%")
    for kind, amt in charged.items():
        if kind not in expected and not (kind == "PST" and version.ship_to_province == "BC" and notes):
            problems.append(f"{kind} ({fmt(amt, version.currency or 'CAD')}) charged but not applicable for "
                            f"delivery province {version.ship_to_province}")
    ev = [_ev("document_field", "taxes", ", ".join(t.get("label", "") for t in version.taxes or []) or "no tax lines"),
          _ev("document_field", "bill_to", version.ship_to_province or "unknown")]
    if problems:
        return Result("tax", "TAX_MISMATCH", "FAIL", True, "; ".join(problems) + ".", "high", evidence=ev, data=detail)
    if notes and any("unknown" in n or "not determinable" in n or "not configured" in n for n in notes):
        return Result("tax", "TAX_UNVERIFIABLE", "UNKNOWN", False, " ".join(notes), "low", evidence=ev, data=detail)
    return _pass("tax", "TAX", f"Tax matches delivery province {version.ship_to_province}. " + " ".join(notes),
                 evidence=ev, data=detail)


def check_arithmetic(version: InvoiceVersion, lines: list[InvoiceLine]) -> Result:
    problems = []
    for ln in lines:
        if ln.unit_price_minor is None or ln.amount_minor is None:
            problems.append(f"line {ln.line_no} amount unreadable")
            continue
        try:
            q = Decimal(ln.quantity)
        except Exception:  # noqa: BLE001
            problems.append(f"line {ln.line_no} quantity unreadable")
            continue
        calc = to_minor(from_minor(ln.unit_price_minor) * q)
        if abs(calc - ln.amount_minor) > LINE_TOLERANCE_MINOR:
            problems.append(f"line {ln.line_no}: {ln.quantity} × {fmt(ln.unit_price_minor)} = {fmt(calc)} "
                            f"but shows {fmt(ln.amount_minor)}")
    line_sum = sum(ln.amount_minor or 0 for ln in lines)
    tax_sum = sum((t.get("amount_minor") or 0) for t in version.taxes or [])
    if version.subtotal_minor is None or version.total_minor is None:
        return Result("arithmetic", "EXTRACTION_INCOMPLETE", "UNKNOWN", True, "Subtotal or total not readable.", "high")
    if line_sum != version.subtotal_minor:
        problems.append(f"lines sum to {fmt(line_sum, version.currency or 'CAD')} but subtotal is "
                        f"{fmt(version.subtotal_minor, version.currency or 'CAD')}")
    if version.subtotal_minor + tax_sum != version.total_minor:
        problems.append(f"subtotal + taxes = {fmt(version.subtotal_minor + tax_sum, version.currency or 'CAD')} "
                        f"but total is {fmt(version.total_minor, version.currency or 'CAD')}")
    data = {"line_sum_minor": line_sum, "tax_sum_minor": tax_sum, "subtotal_minor": version.subtotal_minor,
            "total_minor": version.total_minor, "tolerance_minor": {"line": LINE_TOLERANCE_MINOR, "sums": 0}}
    if problems:
        return Result("arithmetic", "TOTALS_MISMATCH", "FAIL", True, "; ".join(problems) + ".", "high",
                      evidence=[_ev("document_field", "subtotal"), _ev("document_field", "total")], data=data)
    return _pass("arithmetic", "ARITHMETIC", "Lines, subtotal, taxes and total reconcile exactly.", data=data)


def check_vendor(session: Session, version: InvoiceVersion, vendor: Vendor | None) -> list[Result]:
    out: list[Result] = []
    if vendor is None:
        cands = (version.vendor_match or {}).get("candidates") or []
        out.append(Result("vendor_identity", "UNKNOWN_VENDOR", "FAIL", True,
                          f"'{version.vendor_name_raw}' does not match any vendor in the master"
                          + (f" (closest: {', '.join(c['legal_name'] + ' ' + str(c['score']) for c in cands)})" if cands else "")
                          + ". Onboarding required before payment.", "high",
                          evidence=[_ev("document_field", "vendor_name", version.vendor_name_raw)],
                          data={"candidates": cands}))
        return out
    ev = [_ev("vendor", vendor.id, vendor.legal_name)]
    if vendor.status in {"on_hold", "inactive", "blocked"}:
        out.append(Result("vendor_status", "VENDOR_INACTIVE", "FAIL", True,
                          f"Vendor {vendor.id} status is '{vendor.status}'.", "high", evidence=ev))
    elif vendor.status in {"pending_review", "new"}:
        out.append(Result("vendor_status", "VENDOR_PENDING_REVIEW", "FAIL", False,
                          f"Vendor {vendor.id} status is '{vendor.status}': finance manager step added (P05).",
                          "medium", evidence=ev, policy_ids=["P05"]))
    else:
        out.append(_pass("vendor_status", "VENDOR_STATUS", f"Vendor {vendor.id} is active.", evidence=ev))
    if version.vendor_tax_id and vendor.gst_hst_number and version.vendor_tax_id != vendor.gst_hst_number:
        out.append(Result("vendor_identity", "VENDOR_TAX_ID_MISMATCH", "FAIL", True,
                          f"Invoice GST/HST {version.vendor_tax_id} ≠ vendor master {vendor.gst_hst_number}.", "high",
                          evidence=ev + [_ev("document_field", "vendor_tax_id", version.vendor_tax_id)],
                          subject=version.vendor_tax_id))
    sims = vendor_svc.similar_identities(session, vendor)
    hist = {vid: n for vid, n in session.execute(
        select(Invoice.vendor_id, func.count()).where(Invoice.source_kind == "historical_ledger")
        .group_by(Invoice.vendor_id)).all()}
    mine = hist.get(vendor.id, 0)
    for s in sims:
        theirs = hist.get(s["vendor_id"], 0)
        # The record with the established payment history is the reference identity. An invoice
        # attributed to the look-alike with less history is held; the established one gets a warning.
        established = mine >= 3 and mine >= theirs
        out.append(Result("vendor_identity", "DUPLICATE_VENDOR_IDENTITY", "FAIL", not established,
                          f"Vendor '{vendor.legal_name}' ({vendor.id}, {mine} past invoices) closely matches "
                          f"'{s['legal_name']}' ({s['vendor_id']}, status {s['status']}, {theirs} past invoices, "
                          f"name similarity {s['score']}); {'same' if s['same_bank_account'] else 'different'} bank "
                          f"account on file. "
                          + ("This vendor holds the established history; warning only." if established else
                             "This invoice is attributed to the look-alike record with less history; held."),
                          "medium" if established else "high",
                          evidence=ev + [_ev("vendor", s["vendor_id"], s["legal_name"])],
                          data={**s, "invoice_vendor_history": mine, "lookalike_history": theirs},
                          subject=s["vendor_id"]))
    if not sims:
        out.append(_pass("vendor_identity", "VENDOR_IDENTITY", "No look-alike vendor records found.", evidence=ev))
    return out


def check_dates(version: InvoiceVersion) -> list[Result]:
    out: list[Result] = []
    inv, due, rec = version.invoice_date, version.due_date, version.received_date
    if inv and due and due < inv:
        out.append(Result("dates", "DUE_BEFORE_INVOICE_DATE", "FAIL", True, f"Due {due} is before invoice date {inv}.",
                          "medium"))
    if inv and rec and inv > rec:
        out.append(Result("dates", "INVOICE_DATE_IN_FUTURE", "FAIL", True,
                          f"Invoice dated {inv} but received {rec}.", "medium",
                          evidence=[_ev("document_field", "invoice_date", inv)], subject=inv))
    if inv and rec:
        age = (dt.date.fromisoformat(rec) - dt.date.fromisoformat(inv)).days
        if age > 60:
            out.append(Result("dates", "STALE_INVOICE_DATE", "FAIL", False,
                              f"Invoice dated {inv} arrived {age} days later ({rec}).", "low",
                              evidence=[_ev("document_field", "invoice_date", inv)]))
    if not out:
        out.append(_pass("dates", "DATES", "Invoice, due and receipt dates are consistent."))
    return out


def _po_consumed(session: Session, po_id: str, exclude_invoice: str) -> int:
    rows = session.execute(
        select(InvoiceVersion.subtotal_minor, Invoice.lifecycle_state, Invoice.id, Invoice.current_version,
               InvoiceVersion.version)
        .join(Invoice, Invoice.id == InvoiceVersion.invoice_id)
        .where(InvoiceVersion.po_number == po_id, Invoice.id != exclude_invoice)
    ).all()
    return sum(r.subtotal_minor or 0 for r in rows
               if r.version == r.current_version and r.lifecycle_state not in {"REJECTED", "CANCELLED"})


def check_po(session: Session, version: InvoiceVersion, vendor: Vendor | None) -> tuple[list[Result], bool]:
    """Returns results and whether P12 (over balance → finance manager) applies."""
    if version.document_type == "credit_note" or (version.total_minor or 0) < 0:
        return [Result("purchase_order", "PO", "NOT_APPLICABLE", False,
                       "Credit note: PO matching does not apply (never paid out).")], False
    if not version.po_number:
        if vendor is not None and vendor.requires_po:
            return [Result("purchase_order", "PO_MISSING", "FAIL", True,
                           f"Vendor {vendor.id} requires a PO (requires_po=yes) and none is on the invoice.", "high",
                           evidence=[_ev("vendor", vendor.id, "requires_po=yes"),
                                     _ev("document_field", "po_number", "blank")], policy_ids=["P13"])], False
        return [Result("purchase_order", "PO", "NOT_APPLICABLE", False, "No PO referenced and none required.")], False
    po = session.get(PurchaseOrder, version.po_number)
    ev = [_ev("purchase_order", version.po_number)]
    if po is None:
        return [Result("purchase_order", "PO_NOT_FOUND", "FAIL", True, f"PO {version.po_number} not found.", "high",
                       evidence=ev, policy_ids=["P13"] if vendor and vendor.requires_po else [])], False
    if vendor is not None and po.vendor_id != vendor.id:
        return [Result("purchase_order", "PO_VENDOR_MISMATCH", "FAIL", True,
                       f"PO {po.id} belongs to {po.vendor_id}, not {vendor.id}.", "high", evidence=ev)], False
    if po.status not in {"open", "approved", "partially_received"}:
        return [Result("purchase_order", "PO_CLOSED", "FAIL", True, f"PO {po.id} status is '{po.status}'.", "high",
                       evidence=ev)], False
    consumed = _po_consumed(session, po.id, version.invoice_id)
    remaining = po.total_minor - consumed
    amount = version.subtotal_minor or 0
    data = {"po_total_minor": po.total_minor, "consumed_minor": consumed, "remaining_minor": remaining,
            "invoice_subtotal_minor": amount}
    if amount > remaining:
        return [Result("purchase_order", "PO_OVER_BALANCE", "FAIL", False,
                       f"Invoice subtotal {fmt(amount)} exceeds PO {po.id} remaining balance {fmt(remaining)} "
                       f"(P12 → finance manager).", "medium", evidence=ev, policy_ids=["P12"], data=data)], True
    return [_pass("purchase_order", "PO", f"Within PO {po.id} remaining balance {fmt(remaining)}.", evidence=ev,
                  policy_ids=["P12"], data=data)], False


_FUEL_RE = re.compile(r"fuel surcharge|surcharge carburant", re.I)
_PCT_RE = re.compile(r"\(([\d.,]+)\s*%\)")
_HOURLY_RE = re.compile(r"\bhour|\bhours|\bhrs?\b|heure", re.I)


def check_contract(session: Session, version: InvoiceVersion, vendor: Vendor | None,
                   lines: list[InvoiceLine]) -> list[Result]:
    if vendor is None:
        return [Result("contract", "CONTRACT", "NOT_APPLICABLE", False, "Vendor unknown.")]
    contracts = list(session.scalars(select(Contract).where(Contract.vendor_id == vendor.id)))
    if not contracts:
        return [Result("contract", "CONTRACT", "NOT_APPLICABLE", False, "No contract on file for this vendor.")]
    d = version.invoice_date
    covering = [c for c in contracts if c.status == "active" and (not d or ((c.start_date or "") <= d <= (c.end_date or "9999")))]
    if not covering:
        c = contracts[0]
        version.contract_id = c.id
        return [Result("contract", "CONTRACT_EXPIRED", "FAIL", True,
                       f"Contract {c.id} status '{c.status}', term {c.start_date}–{c.end_date}"
                       f"{' (auto-renew flagged but not renewed in the record)' if c.auto_renew else ''}; "
                       f"invoice dated {d}.", "medium", evidence=[_ev("contract", c.id, c.description)],
                       subject=c.id)]
    c = covering[0]
    version.contract_id = c.id
    ev = [_ev("contract", c.id, c.description)]
    out: list[Result] = []
    if c.currency and version.currency and c.currency != version.currency:
        out.append(Result("contract", "CONTRACT_RATE_EXCEEDED", "FAIL", True,
                          f"Invoice currency {version.currency} differs from contract currency {c.currency}.",
                          "medium", evidence=ev, subject=f"{c.id}:currency"))
    if c.billing_type == "fixed_monthly" and c.monthly_fee_minor is not None and version.subtotal_minor is not None:
        if version.subtotal_minor > c.monthly_fee_minor:
            out.append(Result("contract", "CONTRACT_RATE_EXCEEDED", "FAIL", True,
                              f"Subtotal {fmt(version.subtotal_minor, version.currency or 'CAD')} exceeds the fixed "
                              f"monthly fee {fmt(c.monthly_fee_minor, c.currency or 'CAD')} in contract {c.id}.",
                              "high", evidence=ev, subject=f"{c.id}:fee",
                              data={"monthly_fee_minor": c.monthly_fee_minor}))
    if c.hourly_rate_cap_minor is not None:
        for ln in lines:
            if _HOURLY_RE.search(ln.description) and ln.unit_price_minor and ln.unit_price_minor > c.hourly_rate_cap_minor:
                out.append(Result("contract", "CONTRACT_RATE_EXCEEDED", "FAIL", True,
                                  f"Line {ln.line_no} hourly rate {fmt(ln.unit_price_minor)} exceeds the contract cap "
                                  f"{fmt(c.hourly_rate_cap_minor)} ({c.id}).", "high",
                                  evidence=ev + [_ev("invoice_line", f"{version.invoice_id}:{ln.line_no}", ln.description)],
                                  subject=f"{c.id}:line{ln.line_no}"))
    if c.fuel_surcharge_cap_pct:
        cap = Decimal(c.fuel_surcharge_cap_pct)
        base = sum(ln.amount_minor or 0 for ln in lines if not _FUEL_RE.search(ln.description)
                   and "detention" not in ln.description.lower())
        for ln in lines:
            if not _FUEL_RE.search(ln.description):
                continue
            stated = _PCT_RE.search(ln.description)
            stated_pct = Decimal(stated.group(1).replace(",", ".")) if stated else None
            computed = (Decimal(ln.amount_minor or 0) / Decimal(base) * 100).quantize(Decimal("0.01")) if base else None
            pct = stated_pct if stated_pct is not None else computed
            data = {"cap_pct": str(cap), "stated_pct": str(stated_pct) if stated_pct is not None else None,
                    "computed_pct_of_freight": str(computed) if computed is not None else None}
            if pct is not None and pct > cap:
                out.append(Result("contract", "FUEL_SURCHARGE_CAP_EXCEEDED", "FAIL", True,
                                  f"Fuel surcharge {pct}% exceeds the {cap}% cap in contract {c.id}.", "high",
                                  evidence=ev + [_ev("invoice_line", f"{version.invoice_id}:{ln.line_no}", ln.description)],
                                  data=data, subject=f"{c.id}:fuel"))
            else:
                out.append(_pass("contract", "FUEL_SURCHARGE", f"Fuel surcharge {pct}% within {cap}% cap ({c.id}).",
                                 evidence=ev, data=data))
    if c.not_to_exceed_monthly_minor is not None and d and version.subtotal_minor is not None:
        month = d[:7]
        rows = session.execute(
            select(InvoiceVersion.subtotal_minor, InvoiceVersion.invoice_date, InvoiceVersion.version,
                   Invoice.current_version, Invoice.lifecycle_state, Invoice.id)
            .join(Invoice, Invoice.id == InvoiceVersion.invoice_id)
            .where(Invoice.vendor_id == vendor.id, Invoice.id != version.invoice_id,
                   InvoiceVersion.invoice_date.like(f"{month}%"))).all()
        others = sum(r.subtotal_minor or 0 for r in rows if r.version == r.current_version
                     and r.lifecycle_state not in {"REJECTED", "CANCELLED"} and (r.subtotal_minor or 0) > 0)
        total = others + version.subtotal_minor
        if total > c.not_to_exceed_monthly_minor:
            out.append(Result("contract", "CONTRACT_CAP_EXCEEDED", "FAIL", True,
                              f"{month} billing {fmt(total)} (this invoice {fmt(version.subtotal_minor)} + others "
                              f"{fmt(others)}) exceeds the monthly not-to-exceed {fmt(c.not_to_exceed_monthly_minor)} "
                              f"in {c.id}.", "medium", evidence=ev, subject=f"{c.id}:{month}"))
    if not out:
        out.append(_pass("contract", "CONTRACT", f"Consistent with active contract {c.id}.", evidence=ev))
    return out


def check_bank(session: Session, version: InvoiceVersion, vendor: Vendor | None) -> list[Result]:
    if vendor is None:
        return [Result("payment_route", "PAYMENT_ROUTE_UNAVAILABLE", "UNKNOWN", True,
                       "No vendor record, so no verified payment route exists.", "high")]
    out: list[Result] = []
    open_changes = list(session.scalars(select(VendorBankChange).where(
        VendorBankChange.vendor_id == vendor.id, VendorBankChange.state.in_(OPEN_BANK_CHANGE_STATES))))
    for bc in open_changes:
        out.append(Result(
            "bank_change", "BANK_CHANGE_UNVERIFIED", "FAIL", True,
            f"Bank change {bc.id} on {bc.requested_at} via {bc.request_channel} (account ****{bc.old_account_last4} → "
            f"****{bc.new_account_last4}) has not been independently verified (state {bc.state}). The hold applies "
            f"even if the invoice account matches the vendor master.", "critical",
            evidence=[_ev("bank_change", bc.id, f"{bc.request_channel}, verified_by_callback=no"),
                      _ev("vendor", vendor.id, vendor.legal_name)],
            data={"bank_change_id": bc.id, "old_last4": bc.old_account_last4, "new_last4": bc.new_account_last4},
            subject=bc.id))
    remit = version.remit or {}
    method = remit.get("method")
    if method == "EFT":
        fp = remit.get("account_fingerprint")
        route = session.scalar(select(PaymentRoute).where(PaymentRoute.vendor_id == vendor.id,
                                                          PaymentRoute.method == "EFT",
                                                          PaymentRoute.account_fingerprint == fp)) if fp else None
        if route is None:
            out.append(Result("payment_route", "BANK_DETAILS_MISMATCH", "FAIL", True,
                              f"Invoice remit-to account ****{remit.get('account_last4')} does not match any "
                              f"registered account for {vendor.id}.", "critical",
                              evidence=[_ev("document_field", "remit", f"****{remit.get('account_last4')}")],
                              subject=str(remit.get("account_last4"))))
        elif route.status != "VERIFIED":
            if not open_changes:
                out.append(Result("payment_route", "BANK_CHANGE_UNVERIFIED", "FAIL", True,
                                  f"Route {route.id} (****{route.account_last4}) is {route.status}.", "critical",
                                  evidence=[_ev("payment_route", route.id)], subject=route.id))
        else:
            out.append(_pass("payment_route", "PAYMENT_ROUTE",
                             f"Remit-to account ****{route.account_last4} matches verified route {route.id}.",
                             evidence=[_ev("payment_route", route.id, route.provenance)],
                             data={"route_id": route.id}))
    elif method == "CARD":
        route = session.scalar(select(PaymentRoute).where(PaymentRoute.vendor_id == vendor.id,
                                                          PaymentRoute.method == "CARD",
                                                          PaymentRoute.status == "VERIFIED"))
        if route is None:
            out.append(Result("payment_route", "PAYMENT_ROUTE_UNAVAILABLE", "FAIL", True,
                              "Invoice asks for card payment but no verified card route exists for this vendor. "
                              "Card history alone is not proof of merchant ownership.", "high"))
        else:
            out.append(_pass("payment_route", "PAYMENT_ROUTE", f"Verified card route {route.id} on file.",
                             evidence=[_ev("payment_route", route.id, route.provenance)], data={"route_id": route.id}))
    else:
        out.append(Result("payment_route", "PAYMENT_ROUTE_UNAVAILABLE", "UNKNOWN", True,
                          "Remit-to instructions could not be read.", "high"))
    if not open_changes and all(r.result == "PASS" for r in out):
        out.append(_pass("bank_change", "BANK_CHANGE", "No pending bank-detail changes for this vendor."))
    return out


def check_people(session: Session, version: InvoiceVersion) -> list[Result]:
    out: list[Result] = []
    if not version.department_id:
        out.append(Result("routing_inputs", "DEPARTMENT_UNASSIGNED", "UNKNOWN", True,
                          "Requesting department could not be determined (no PO and no vendor history).", "medium"))
    if version.requester_id:
        u = session.get(User, version.requester_id)
        if u is not None and u.status == "terminated":
            out.append(Result("routing_inputs", "REQUESTER_TERMINATED", "FAIL", False,
                              f"Requester {u.id} terminated since {u.status_since}; department manager owns rework.",
                              "low", evidence=[_ev("user", u.id)]))
    return out


def run_checks(session: Session, version: InvoiceVersion, lines: list[InvoiceLine]) -> tuple[list[Result], dict[str, Any]]:
    vendor = session.get(Vendor, version.vendor_id) if version.vendor_id else None
    results: list[Result] = []
    missing = [f for f in ("invoice_number", "invoice_date", "total", "currency", "lines", "document")
               if f in (version.uncertain_fields or []) or (f == "total" and version.total_minor is None)]
    if missing:
        results.append(Result("extraction", "EXTRACTION_INCOMPLETE", "UNKNOWN", True,
                              f"Could not read: {', '.join(sorted(set(missing)))}. Values are left blank, not guessed.",
                              "high", data={"uncertain_fields": version.uncertain_fields}))
    else:
        results.append(_pass("extraction", "EXTRACTION",
                             f"All required fields read (provenance: {version.provenance}).",
                             data={"uncertain_fields": version.uncertain_fields}))
    inj = (version.evidence or {}).get("injection_phrases") or []
    if inj:
        results.append(Result("document_safety", "PROMPT_INJECTION_TEXT", "FAIL", True,
                              f"Document contains instruction-like text: {inj}. Treated as data; no action taken.",
                              "high", subject="|".join(inj)))
    results.append(apply_fx(session, version))
    results.extend(check_vendor(session, version, vendor))
    if version.total_minor is not None and version.subtotal_minor is not None:
        results.append(check_arithmetic(version, lines))
        results.append(check_tax(version, vendor, lines))
    results.extend(check_dates(version))
    po_results, po_over = check_po(session, version, vendor)
    results.extend(po_results)
    results.extend(check_contract(session, version, vendor, lines))
    if version.document_type != "credit_note":
        results.extend(check_bank(session, version, vendor))
    results.extend(check_people(session, version))
    needs_coding = [ln.line_no for ln in lines if ln.coding_status == "NEEDS_REVIEW"]
    if needs_coding:
        results.append(Result("coding", "LOW_CODING_CONFIDENCE", "UNKNOWN", True,
                              f"Lines {needs_coding} have coding confidence below 0.70 or no department.", "low"))
    elif lines:
        results.append(_pass("coding", "CODING", "All lines coded at ≥ 0.70 confidence or confirmed by a person."))
    return results, {"po_over_balance": po_over, "vendor": vendor}
