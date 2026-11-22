"""AnalyticsService: spend and workload figures computed from stored records (bonus: "Show spend
analytics by vendor, department and category").

Every figure is an aggregate of persisted rows, so it can be recomputed and audited; nothing is
estimated or invented. Scope follows the same rules as invoice visibility: finance, AP and audit roles
see everything; a department approver sees their department; a requester sees their own invoices.

* Spend = historical invoices that were paid (ledger status "paid"), CAD at the invoice-date rate,
  net of credit notes, by invoice month. Rejected invoices are excluded.
* Processing, holds and approvals cover the invoices currently in the workflow (not the ledger).
* Payments include the historical ledger and simulated payments; simulated ones are labelled."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import GLOBAL_READ_ROLES
from app.db.models import Department, Invoice, InvoiceVersion, Payment, User, Vendor
from app.services import catalog, pipeline

TOP_VENDORS = 8


def _scope(actor: User) -> tuple[str, Any]:
    if actor.role in GLOBAL_READ_ROLES:
        return "all", None
    if actor.role == "approver":
        return "department", actor.department_id
    return "own", actor.id


def _visible(scope: tuple[str, Any], v: InvoiceVersion) -> bool:
    kind, key = scope
    if kind == "all":
        return True
    if kind == "department":
        return v.department_id == key
    return v.requester_id == key


def _bucket(rows: dict[str, list[int]], key: str, amount: int) -> None:
    rows[key][0] += amount
    rows[key][1] += 1


def _ranked(rows: dict[str, list[int]], labels: dict[str, str], top: int | None = None) -> list[dict[str, Any]]:
    items = sorted(rows.items(), key=lambda kv: (-kv[1][0], kv[0]))
    out = [{"key": k, "label": labels.get(k, k), "cad_minor": a, "count": n} for k, (a, n) in items]
    if top is not None and len(out) > top:
        rest = out[top:]
        out = out[:top] + [{"key": "other", "label": f"{len(rest)} other suppliers",
                            "cad_minor": sum(r["cad_minor"] for r in rest), "count": sum(r["count"] for r in rest)}]
    return out


def summary(session: Session, actor: User) -> dict[str, Any]:
    scope = _scope(actor)
    vendors = {v.id: v for v in session.scalars(select(Vendor))}
    departments = {d.id: d.name for d in session.scalars(select(Department))}
    users = pipeline.users_map(session)
    rows = session.execute(
        select(Invoice, InvoiceVersion).join(InvoiceVersion, (InvoiceVersion.invoice_id == Invoice.id)
                                             & (InvoiceVersion.version == Invoice.current_version))).all()

    by_month: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_dept: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_vendor: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_category: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    status: dict[str, int] = defaultdict(int)
    holds: dict[str, int] = defaultdict(int)
    workload: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    spend_total = paid_count = 0
    on_hold = waiting = workflow_total = 0
    visible_invoice_ids: set[str] = set()

    for inv, v in rows:
        if not _visible(scope, v):
            continue
        visible_invoice_ids.add(inv.id)
        amount = v.amount_cad_minor or 0
        if inv.source_kind == "historical_ledger":
            if inv.historical_status != "paid":
                continue
            spend_total += amount
            paid_count += 1
            if v.invoice_date:
                _bucket(by_month, v.invoice_date[:7], amount)
            _bucket(by_dept, v.department_id or "unassigned", amount)
            if inv.vendor_id:
                _bucket(by_vendor, inv.vendor_id, amount)
                _bucket(by_category, (vendors[inv.vendor_id].category or "Uncategorized")
                        if inv.vendor_id in vendors else "Uncategorized", amount)
            continue
        workflow_total += 1
        status[inv.lifecycle_state] += 1
        if inv.lifecycle_state == "ON_HOLD":
            on_hold += 1
            for code in {f.code for f in pipeline.blocking_findings(session, inv.id, v.version)}:
                holds[code] += 1
        if inv.lifecycle_state == "PENDING_APPROVAL":
            waiting += 1
            for step, st, _decision in pipeline.step_statuses(session, inv.id, v.version):
                if st in {"PENDING", "WAITING"} and step.assigned_actor_id:
                    _bucket(workload, step.assigned_actor_id, amount)

    payments: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    methods: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for p in session.scalars(select(Payment)):
        if p.invoice_id not in visible_invoice_ids:
            continue
        if p.source == "simulation":
            key = f"simulated_{p.state.lower()}"
        else:
            key = (p.historical_status or "unknown").lower()
        _bucket(payments, key, p.amount_cad_minor)
        if key not in {"simulated_cancelled", "simulated_failed"}:
            _bucket(methods, p.method, p.amount_cad_minor)

    payment_labels = {"settled": "Paid", "scheduled": "Scheduled", "outstanding": "Outstanding",
                      "simulated_scheduled": "Scheduled (simulated)", "simulated_released": "Released (simulated)",
                      "simulated_settled": "Paid (simulated)", "simulated_failed": "Failed (simulated)",
                      "simulated_cancelled": "Cancelled (simulated)"}
    return {
        "scope": scope[0],
        "scope_label": {"all": "All of Harborline Logistics",
                        "department": f"{departments.get(scope[1], scope[1])} department",
                        "own": "Invoices you requested"}[scope[0]],
        "kpis": {"spend_cad_minor": spend_total, "paid_invoices": paid_count, "in_workflow": workflow_total,
                 "on_hold": on_hold, "waiting_for_approval": waiting},
        "spend_by_month": [{"key": k, "label": k, "cad_minor": a, "count": n}
                           for k, (a, n) in sorted(by_month.items())],
        "spend_by_department": _ranked(by_dept, {**departments, "unassigned": "No department"}),
        "spend_by_vendor": _ranked(by_vendor, {k: v.legal_name for k, v in vendors.items()}, top=TOP_VENDORS),
        "spend_by_category": _ranked(by_category, {}),
        "processing_status": [{"key": k, "label": k, "cad_minor": 0, "count": n}
                              for k, n in sorted(status.items(), key=lambda kv: (-kv[1], kv[0]))],
        "hold_reasons": [{"key": k, "label": catalog.info(k).title, "cad_minor": 0, "count": n}
                         for k, n in sorted(holds.items(), key=lambda kv: (-kv[1], kv[0]))],
        "approval_workload": _ranked(workload, {k: u.full_name for k, u in users.items()}),
        "payment_status": _ranked(payments, payment_labels),
        "payment_methods": _ranked(methods, {"EFT": "EFT", "CHEQUE": "Cheque", "CARD": "Brim virtual card"}),
        "notes": ["Synthetic Harborline Logistics data (January–October 2026 history plus the incoming batch).",
                  "Spend counts paid invoices only, in CAD at each invoice's date rate, net of credit notes.",
                  "October is partial: the history ends in late October and newer invoices are still open.",
                  "Simulated payments are labelled; no real money moves."],
    }
