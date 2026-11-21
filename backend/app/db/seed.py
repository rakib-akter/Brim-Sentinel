"""Idempotent dataset import: master data, ledger history and the incoming email batch.

Re-running is safe: master rows are merged by primary key, historical rows are skipped if present,
and email attachments are deduplicated by (source email id, SHA-256) at the Document level."""
from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.money import to_minor
from app.db import models as m
from app.services import audit


def _rows(data_dir: Path, name: str) -> list[dict[str, str]]:
    with open(data_dir / "data" / name, newline="", encoding="utf-8") as fh:
        return [{k: (v.strip() if isinstance(v, str) else v) for k, v in r.items()} for r in csv.DictReader(fh)]


def _n(v: str | None) -> str | None:
    return v if v not in (None, "") else None


def _minor(v: str | None) -> int | None:
    return to_minor(v) if v not in (None, "") else None


def account_fingerprint(institution: str | None, transit: str | None, account: str | None) -> str | None:
    if not account:
        return None
    return hashlib.sha256(f"{institution or ''}|{transit or ''}|{account}".encode()).hexdigest()


SERVICE_USER_ID = "SVC-SENTINEL"


def seed_master(session: Session, data_dir: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    for r in _rows(data_dir, "departments.csv"):
        session.merge(m.Department(id=r["department_id"], name=r["name"], cost_centre=r["cost_centre"],
                                   annual_budget_minor=_minor(r["annual_budget_cad"]),
                                   manager_user_id=_n(r["manager_user_id"])))
    counts["departments"] = len(_rows(data_dir, "departments.csv"))
    users = _rows(data_dir, "users.csv")
    for r in users:
        session.merge(m.User(id=r["user_id"], full_name=r["full_name"], email=r["email"], title=r["title"],
                             department_id=_n(r["department_id"]), manager_id=_n(r["manager_id"]), role=r["role"],
                             approval_limit_minor=_minor(r["approval_limit_cad"]) or 0,
                             work_province=_n(r["work_province"]), status=r["status"],
                             status_since=_n(r["status_since"]), delegate_user_id=_n(r["delegate_user_id"]),
                             kind="human"))
    # Sentinel's own service identity: read/propose only. Has no approval limit and no permissions.
    session.merge(m.User(id=SERVICE_USER_ID, full_name="Sentinel service (AI)", email=None,
                         title="Automated assistant", department_id=None, manager_id=None, role="service_ai",
                         approval_limit_minor=0, work_province=None, status="active", status_since=None,
                         delegate_user_id=None, kind="service"))
    counts["users"] = len(users)

    bank_changes = _rows(data_dir, "bank_change_history.csv")
    unverified_by_vendor: dict[str, dict[str, str]] = {}
    for r in bank_changes:
        if r["verified_by_callback"].lower() != "yes":
            unverified_by_vendor[r["vendor_id"]] = r

    vendors = _rows(data_dir, "vendors.csv")
    for r in vendors:
        session.merge(m.Vendor(
            id=r["vendor_id"], legal_name=r["legal_name"], category=_n(r["category"]),
            default_gl_account=_n(r["default_gl_account"]), address=_n(r["address"]),
            province_or_state=_n(r["province_or_state"]), country=_n(r["country"]),
            gst_hst_number=_n(r["gst_hst_number"]), qst_number=_n(r["qst_number"]),
            payment_terms_days=int(r["payment_terms_days"]) if r["payment_terms_days"] else None,
            preferred_payment_method=_n(r["preferred_payment_method"]),
            accepts_card_payment=r["accepts_card_payment"].lower() == "yes",
            bank_institution=_n(r["bank_institution"]), bank_transit=_n(r["bank_transit"]),
            bank_account=_n(r["bank_account"]), bank_details_updated_at=_n(r["bank_details_updated_at"]),
            ap_contact_email=_n(r["ap_contact_email"]), requires_po=r["requires_po"].lower() == "yes",
            status=r["status"], onboarded_at=_n(r["onboarded_at"]), source="dataset"))
        if r["ap_contact_email"]:
            session.merge(m.VendorContact(id=f"VC-{r['vendor_id']}-EMAIL", vendor_id=r["vendor_id"], channel="email",
                                          value=r["ap_contact_email"], source="vendor_master",
                                          established_at=r["onboarded_at"] or "1970-01-01"))
        # Payment-route registry derived from master data and bank-change history.
        if r["bank_account"]:
            unv = unverified_by_vendor.get(r["vendor_id"])
            is_unverified = bool(unv and unv["new_account_last4"] == r["bank_account"][-4:])
            session.merge(m.PaymentRoute(
                id=f"RT-{r['vendor_id']}-EFT", vendor_id=r["vendor_id"], method="EFT",
                account_last4=r["bank_account"][-4:],
                account_fingerprint=account_fingerprint(r["bank_institution"], r["bank_transit"], r["bank_account"]),
                status="UNVERIFIED" if is_unverified else "VERIFIED",
                provenance=(f"vendor master; bank change {unv['change_id']} requested via {unv['request_channel']} "
                            f"with verified_by_callback=no" if is_unverified else
                            f"vendor master (synthetic dataset), onboarded {r['onboarded_at']}"),
                verified_at=None if is_unverified else (r["bank_details_updated_at"] or r["onboarded_at"]),
                bank_change_id=unv["change_id"] if is_unverified else None))
        if r["preferred_payment_method"] == "CARD":
            session.merge(m.PaymentRoute(
                id=f"RT-{r['vendor_id']}-CARD", vendor_id=r["vendor_id"], method="CARD", account_last4=None,
                account_fingerprint=None, status="VERIFIED",
                provenance="SYNTHETIC FIXTURE: vendor master preferred_payment_method=CARD; simulated Brim "
                           "single-use virtual card route (not a live merchant verification)",
                verified_at=r["onboarded_at"], bank_change_id=None))
        if r["preferred_payment_method"] == "CHEQUE":
            session.merge(m.PaymentRoute(
                id=f"RT-{r['vendor_id']}-CHEQUE", vendor_id=r["vendor_id"], method="CHEQUE", account_last4=None,
                account_fingerprint=None, status="VERIFIED",
                provenance="vendor master address on file (synthetic dataset)", verified_at=r["onboarded_at"],
                bank_change_id=None))
    counts["vendors"] = len(vendors)

    for r in bank_changes:
        verified = r["verified_by_callback"].lower() == "yes"
        existing = session.get(m.VendorBankChange, r["change_id"])
        if existing is not None:
            continue  # keep any workflow progress made in the app
        session.add(m.VendorBankChange(
            id=r["change_id"], vendor_id=r["vendor_id"], requested_at=r["changed_at"],
            requested_by_user_id=_n(r["changed_by_user_id"]), request_channel=r["request_channel"],
            old_account_last4=_n(r["old_account_last4"]), new_account_last4=_n(r["new_account_last4"]),
            new_route_id=f"RT-{r['vendor_id']}-EFT",
            state="CLOSED" if verified else "PENDING_INDEPENDENT_VERIFICATION", source="dataset",
            verified_by_callback_source=verified))
    counts["bank_changes"] = len(bank_changes)

    for r in _rows(data_dir, "contracts.csv"):
        session.merge(m.Contract(
            id=r["contract_id"], vendor_id=r["vendor_id"], description=_n(r["description"]),
            billing_type=_n(r["billing_type"]), monthly_fee_minor=_minor(r["monthly_fee"]), currency=_n(r["currency"]),
            hourly_rate_cap_minor=_minor(r["hourly_rate_cap"]), fuel_surcharge_cap_pct=_n(r["fuel_surcharge_cap_pct"]),
            not_to_exceed_monthly_minor=_minor(r["not_to_exceed_monthly"]), start_date=_n(r["start_date"]),
            end_date=_n(r["end_date"]), auto_renew=r["auto_renew"].lower() == "yes", status=_n(r["status"])))
    for r in _rows(data_dir, "purchase_orders.csv"):
        session.merge(m.PurchaseOrder(
            id=r["po_id"], vendor_id=r["vendor_id"], department_id=_n(r["department_id"]),
            requester_user_id=_n(r["requester_user_id"]), issue_date=_n(r["issue_date"]),
            description=_n(r["description"]), total_minor=to_minor(r["total_amount"]), currency=r["currency"],
            status=r["status"], approved_by=_n(r["approved_by"])))
    for r in _rows(data_dir, "gl_accounts.csv"):
        session.merge(m.GLAccount(account_number=r["account_number"], name=r["name"],
                                  account_type=_n(r["account_type"]), notes=_n(r["notes"])))
    for r in _rows(data_dir, "tax_codes.csv"):
        session.merge(m.TaxCode(code=r["code"], description=r["description"], rate=r["rate"],
                                applies_to=_n(r["applies_to"]), recoverable=_n(r["recoverable"]),
                                gl_account=_n(r["gl_account"])))
    for r in _rows(data_dir, "fx_rates.csv"):
        session.merge(m.FxRate(date=r["date"], usd_to_cad=r["usd_to_cad"]))
    for r in _rows(data_dir, "approval_policies.csv"):
        session.merge(m.ApprovalPolicy(rule_id=r["rule_id"], rule_type=r["rule_type"], condition=r["condition"],
                                       required=r["required"], notes=_n(r["notes"])))
    if not session.scalar(select(func.count()).select_from(m.CardTransaction)):
        cards = _rows(data_dir, "card_transactions.csv")
        for r in cards:
            session.add(m.CardTransaction(
                id=r["txn_id"], card_id=_n(r["card_id"]), cardholder_user_id=_n(r["cardholder_user_id"]),
                posted_date=r["posted_date"], merchant_descriptor=r["merchant_descriptor"], mcc=_n(r["mcc"]),
                amount_minor=to_minor(r["amount"]), currency=r["currency"], amount_cad_minor=to_minor(r["amount_cad"]),
                source=_n(r["source"]), receipt_attached=r["receipt_attached"].lower() == "yes", memo=_n(r["memo"])))
    counts["card_transactions"] = session.scalar(select(func.count()).select_from(m.CardTransaction)) or 0
    session.flush()
    return counts


HIST_STATE = {"paid": "SETTLED", "scheduled": "SCHEDULED", "approved": "APPROVED",
              "pending_approval": "PENDING_APPROVAL", "rejected": "REJECTED"}


def seed_history(session: Session, data_dir: Path) -> dict[str, int]:
    """Ledger history (Jan–Oct 2026) is imported read-only as reference data for duplicates,
    anomaly baselines and coding. It is labelled source_kind='historical_ledger' and offers no
    workflow actions: it was not processed by Sentinel's controls."""
    from app.services.extraction import normalize_invoice_number

    if session.scalar(select(func.count()).select_from(m.Invoice).where(m.Invoice.source_kind == "historical_ledger")):
        return {"historical_invoices": 0, "skipped": 1}
    lines_by_inv: dict[str, list[dict[str, str]]] = {}
    for r in _rows(data_dir, "invoice_lines.csv"):
        lines_by_inv.setdefault(r["invoice_id"], []).append(r)
    invs = _rows(data_dir, "invoices.csv")
    for r in invs:
        total = to_minor(r["total"])
        session.add(m.Invoice(id=r["invoice_id"], source_kind="historical_ledger",
                              kind="credit_note" if total < 0 else "invoice", vendor_id=r["vendor_id"],
                              lifecycle_state=HIST_STATE.get(r["status"], "SETTLED"), current_version=1,
                              historical_status=r["status"]))
        taxes = []
        if _minor(r["gst_hst_amount"]):
            taxes.append({"label": "GST/HST", "kind": "GST/HST", "rate_pct": None, "amount_minor": _minor(r["gst_hst_amount"])})
        if _minor(r["pst_qst_amount"]):
            taxes.append({"label": "PST/QST", "kind": "PST/QST", "rate_pct": None, "amount_minor": _minor(r["pst_qst_amount"])})
        session.add(m.InvoiceVersion(
            invoice_id=r["invoice_id"], version=1, created_by="dataset", reason="historical ledger import",
            provenance="dataset_csv", vendor_id=r["vendor_id"], vendor_name_raw=None,
            invoice_number_raw=r["vendor_invoice_number"],
            invoice_number_norm=normalize_invoice_number(r["vendor_invoice_number"]), document_type="invoice",
            invoice_date=r["invoice_date"], due_date=_n(r["due_date"]), received_date=_n(r["received_date"]),
            currency=r["currency"], subtotal_minor=_minor(r["subtotal"]), taxes=taxes, total_minor=total,
            fx_rate=r["fx_rate_to_cad"], fx_date=r["invoice_date"], amount_cad_minor=to_minor(r["total_cad"]),
            ship_to_province=_n(r["ship_to_province"]), po_number=_n(r["po_id"]), contract_id=_n(r["contract_id"]),
            department_id=_n(r["department_id"]), department_source="dataset_csv",
            requester_id=_n(r["requester_user_id"]), requester_source="dataset_csv"))
        for ln in lines_by_inv.get(r["invoice_id"], []):
            session.add(m.InvoiceLine(
                invoice_id=r["invoice_id"], version=1, line_no=int(ln["line_no"]), description=ln["description"],
                quantity=ln["quantity"], unit_price_minor=_minor(ln["unit_price"]), amount_minor=_minor(ln["amount"]),
                line_type=_n(ln["line_type"]), gl_account=_n(ln["gl_account"]), department_id=_n(ln["department_id"]),
                coding_status="HISTORICAL",
                coding_detail={"gst_hst_code": ln["gst_hst_code"], "pst_qst_code": ln["pst_qst_code"]}))
    for r in _rows(data_dir, "approvals.csv"):
        session.add(m.ApprovalDecision(
            id=r["approval_id"], invoice_id=r["invoice_id"], version=1,
            step_key=f"hist-{r['step_no']}-{r['approver_role']}", actor_id=r["approver_user_id"],
            delegated_from_id=None, decision="APPROVED" if r["action"] == "approved" else "REJECTED",
            reason=_n(r["comment"]), source="historical_import"))
    for r in _rows(data_dir, "payments.csv"):
        session.add(m.Payment(
            id=r["payment_id"], invoice_id=r["invoice_id"], invoice_version=1, vendor_id=r["vendor_id"],
            method=r["method"], route_id=None, currency=r["currency"], amount_minor=to_minor(r["amount"]),
            amount_cad_minor=to_minor(r["amount_cad"]), state="HISTORICAL", simulation=False,
            source="historical_import", prepared_by=_n(r["prepared_by"]), released_by=_n(r["released_by"]),
            reference=_n(r["reference"]), scheduled_date=_n(r["scheduled_date"]), historical_status=r["status"]))
    session.flush()
    return {"historical_invoices": len(invs)}


def run_seed(session: Session, *, process_inbox: bool = True) -> dict[str, Any]:
    from app.services import intake

    data_dir = get_settings().data_dir
    if not (data_dir / "data").exists():
        raise FileNotFoundError(f"BRIM_DATA_DIR does not contain data/: {data_dir}")
    counts: dict[str, Any] = {}
    counts.update(seed_master(session, data_dir))
    counts.update(seed_history(session, data_dir))
    if process_inbox:
        counts["intake"] = intake.import_inbox(session, actor=None)
    audit.record(session, actor=None, action="dataset.seed", object_type="dataset", object_id=str(data_dir.name),
                 details={"counts": counts})
    return counts
