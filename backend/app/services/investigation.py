"""InvestigationService (PRD §5A as amended by v1.4 A3).

* Fixed, parameterized, read-only lookups only — no SQL tool, no write tool, no approve/verify/
  release tool. The registry below is the complete tool surface.
* Validated IDs, case/invoice scope, 200-row cap, 3 s budget per lookup, max 8 lookups per run.
* Bank account numbers are masked to the last 4 digits.
* Every lookup is written to the audit log (tool, sanitized args, row count, result hash, duration),
  so it appears in the Flight Recorder.
* Output schema {summary, evidence, proposed_actions, open_questions, complete}; every number in
  the summary must appear in a cited lookup result (fact check) or the deterministic template is used.
* AI off/unavailable → deterministic investigation; holds are never changed by this service."""
from __future__ import annotations

import hashlib
import json
import re
import time
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Forbidden
from app.core.money import fmt
from app.db.models import (
    ApprovalDecision,
    CardTransaction,
    Contract,
    Invoice,
    InvoiceVersion,
    ResolutionCase,
    User,
    Vendor,
    VendorBankChange,
)
from app.integrations import ai_gateway
from app.services import audit, pipeline
from app.services.vendors import mask

MAX_CALLS = 8
ROW_CAP = 200
LOOKUP_BUDGET_S = 3.0
PROMPT_VERSION = "investigation_v1"
ALLOWED_PROPOSALS = {"trusted_callback", "request_corrected_invoice", "inspect_card_receipt", "vendor_onboarding",
                     "escalate_to_controller", "confirm_coding"}
_ID = re.compile(r"^[A-Za-z0-9\-]{1,40}$")


class BudgetExhausted(Exception):
    pass


def _check_id(v: str) -> str:
    if not isinstance(v, str) or not _ID.match(v):
        raise ValueError(f"invalid id {v!r}")
    return v


# ---------------------------------------------------------------- the complete tool registry
def get_invoice_evidence(s: Session, scope: dict, invoice_id: str) -> list[dict]:
    if invoice_id != scope["invoice_id"]:
        raise Forbidden("OUT_OF_SCOPE", "Lookup outside the case scope.")
    inv = s.get(Invoice, invoice_id)
    v = pipeline.current_version(s, inv)
    rows = [{"invoice_id": inv.id, "version": v.version, "invoice_number": v.invoice_number_raw,
             "invoice_date": v.invoice_date, "total": fmt(v.total_minor, v.currency or "CAD"),
             "remit_account": mask((v.remit or {}).get("account_last4")), "vendor_id": inv.vendor_id}]
    rows += [{"finding_id": f.id, "code": f.code, "result": f.result, "rationale": f.rationale}
             for f in pipeline.latest_findings(s, inv.id, v.version) if f.result in {"FAIL", "UNKNOWN"}]
    return rows


def get_vendor_profile(s: Session, scope: dict, vendor_id: str) -> list[dict]:
    if vendor_id != scope["vendor_id"]:
        raise Forbidden("OUT_OF_SCOPE", "Lookup outside the case scope.")
    v = s.get(Vendor, vendor_id)
    return [{"vendor_id": v.id, "legal_name": v.legal_name, "status": v.status, "category": v.category,
             "bank_account": mask(v.bank_account[-4:]) if v.bank_account else None,
             "bank_details_updated_at": v.bank_details_updated_at, "contact_on_file": v.ap_contact_email}] if v else []


def get_bank_changes(s: Session, scope: dict, vendor_id: str) -> list[dict]:
    if vendor_id != scope["vendor_id"]:
        raise Forbidden("OUT_OF_SCOPE", "Lookup outside the case scope.")
    return [{"change_id": b.id, "requested_at": b.requested_at, "channel": b.request_channel,
             "verified_by_callback": "yes" if b.state == "CLOSED" else "no", "state": b.state,
             "old_account": mask(b.old_account_last4), "new_account": mask(b.new_account_last4)}
            for b in s.scalars(select(VendorBankChange).where(VendorBankChange.vendor_id == vendor_id))]


def get_contract_terms(s: Session, scope: dict, vendor_id: str) -> list[dict]:
    if vendor_id != scope["vendor_id"]:
        raise Forbidden("OUT_OF_SCOPE", "Lookup outside the case scope.")
    return [{"contract_id": c.id, "billing_type": c.billing_type, "status": c.status, "end_date": c.end_date,
             "fuel_cap_pct": c.fuel_surcharge_cap_pct} for c in s.scalars(select(Contract).where(Contract.vendor_id == vendor_id))]


def find_related_invoices(s: Session, scope: dict, vendor_id: str) -> list[dict]:
    if vendor_id != scope["vendor_id"]:
        raise Forbidden("OUT_OF_SCOPE", "Lookup outside the case scope.")
    rows = s.execute(select(Invoice.id, InvoiceVersion.invoice_number_raw, InvoiceVersion.invoice_date,
                            InvoiceVersion.total_minor, InvoiceVersion.currency, Invoice.lifecycle_state)
                     .join(InvoiceVersion, (InvoiceVersion.invoice_id == Invoice.id)
                           & (InvoiceVersion.version == Invoice.current_version))
                     .where(Invoice.vendor_id == vendor_id).order_by(InvoiceVersion.invoice_date.desc())).all()
    return [{"invoice_id": r[0], "invoice_number": r[1], "invoice_date": r[2], "total": fmt(r[3], r[4] or "CAD"),
             "state": r[5]} for r in rows]


def _like_escape(v: str) -> str:
    return v.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def get_card_transactions(s: Session, scope: dict, vendor_id: str) -> list[dict]:
    if vendor_id != scope["vendor_id"]:
        raise Forbidden("OUT_OF_SCOPE", "Lookup outside the case scope.")
    v = s.get(Vendor, vendor_id)
    key = (v.legal_name.split()[0] if v else "").upper()
    return [{"txn_id": t.id, "posted_date": t.posted_date, "descriptor": t.merchant_descriptor,
             "amount": fmt(t.amount_minor, t.currency), "memo": t.memo,
             "note": "Descriptor match is a candidate, never proof of merchant ownership."}
            for t in s.scalars(select(CardTransaction).where(
                CardTransaction.merchant_descriptor.like(f"%{_like_escape(key)}%", escape="\\")).limit(200))] if key else []


def get_approval_history(s: Session, scope: dict, invoice_id: str) -> list[dict]:
    if invoice_id != scope["invoice_id"]:
        raise Forbidden("OUT_OF_SCOPE", "Lookup outside the case scope.")
    return [{"step": d.step_key, "actor_id": d.actor_id, "decision": d.decision, "version": d.version}
            for d in s.scalars(select(ApprovalDecision).where(ApprovalDecision.invoice_id == invoice_id))]


TOOLS: dict[str, Callable[..., list[dict]]] = {
    "get_invoice_evidence": get_invoice_evidence,
    "get_vendor_profile": get_vendor_profile,
    "get_bank_changes": get_bank_changes,
    "get_contract_terms": get_contract_terms,
    "find_related_invoices": find_related_invoices,
    "get_card_transactions": get_card_transactions,
    "get_approval_history": get_approval_history,
}


class Runner:
    def __init__(self, s: Session, actor: User, case: ResolutionCase, max_calls: int = MAX_CALLS):
        inv = s.get(Invoice, case.invoice_id)
        self.s, self.actor, self.case, self.max_calls = s, actor, case, max_calls
        self.scope = {"invoice_id": case.invoice_id, "vendor_id": inv.vendor_id if inv else None}
        self.calls: list[dict[str, Any]] = []
        self.results: dict[str, list[dict]] = {}

    def call(self, tool: str, **args: str) -> list[dict]:
        if tool not in TOOLS:
            raise Forbidden("TOOL_NOT_ALLOWED", f"'{tool}' is not an allowlisted read-only lookup.")
        if len(self.calls) >= self.max_calls:
            raise BudgetExhausted()
        clean = {k: _check_id(v) for k, v in args.items()}
        t0 = time.monotonic()
        rows = TOOLS[tool](self.s, self.scope, **clean)[:ROW_CAP]
        dur = time.monotonic() - t0
        h = hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()
        ref = f"{tool}#{len(self.calls) + 1}"
        self.results[ref] = rows
        self.calls.append({"ref": ref, "tool": tool, "args": clean, "rows": len(rows), "result_hash": h,
                           "duration_ms": round(dur * 1000, 1), "over_budget": dur > LOOKUP_BUDGET_S})
        audit.record(self.s, actor=self.actor, action="investigation.lookup", object_type="case",
                     object_id=self.case.id, invoice_id=self.case.invoice_id, result="INFO",
                     details={"tool": tool, "args": clean, "row_count": len(rows), "result_hash": h,
                              "duration_ms": round(dur * 1000, 1), "model": None, "prompt_version": PROMPT_VERSION})
        return rows


def numbers_supported(summary: str, results: dict[str, list[dict]]) -> list[str]:
    """Fact check: every number/date token in the summary must appear in some cited lookup result."""
    corpus = json.dumps(results, default=str)
    tokens = re.findall(r"\d[\d,]*(?:\.\d+)?(?:-\d{2}-\d{2})?", summary)
    return [t for t in tokens if t not in corpus and t.replace(",", "") not in corpus]


def _deterministic(r: Runner) -> dict[str, Any]:
    case, inv_id, vid = r.case, r.scope["invoice_id"], r.scope["vendor_id"]
    complete = True
    lines: list[str] = []
    evidence: list[str] = []
    proposals: list[str] = []
    questions: list[str] = []
    try:
        ie = r.call("get_invoice_evidence", invoice_id=inv_id)
        evidence.append(r.calls[-1]["ref"])
        head = ie[0]
        lines.append(f"Invoice {head['invoice_number']} dated {head['invoice_date']} for {head['total']} "
                     f"(remit to {head['remit_account']}).")
        if vid and case.case_type in {"BANK_CHANGE_UNVERIFIED", "BANK_DETAILS_MISMATCH"}:
            bcs = r.call("get_bank_changes", vendor_id=vid)
            evidence.append(r.calls[-1]["ref"])
            for b in bcs:
                if b["verified_by_callback"] == "no":
                    lines.append(f"Bank change {b['change_id']} on {b['requested_at']} came by {b['channel']} and is "
                                 f"not verified by callback ({b['old_account']} → {b['new_account']}).")
                    if b["requested_at"] == head["invoice_date"]:
                        lines.append(f"The invoice is dated the same day as the change ({b['requested_at']}).")
            r.call("get_vendor_profile", vendor_id=vid)
            evidence.append(r.calls[-1]["ref"])
            proposals.append("trusted_callback")
            questions.append("Can the supplier confirm the change through the contact already on file?")
        elif vid and case.case_type in {"CARD_PAID_DUPLICATE", "DUPLICATE_CANDIDATE", "DUPLICATE_INVOICE"}:
            r.call("find_related_invoices", vendor_id=vid)
            evidence.append(r.calls[-1]["ref"])
            r.call("get_card_transactions", vendor_id=vid)
            evidence.append(r.calls[-1]["ref"])
            proposals.append("inspect_card_receipt")
        elif vid and case.case_type in {"CONTRACT_RATE_EXCEEDED", "FUEL_SURCHARGE_CAP_EXCEEDED", "CONTRACT_EXPIRED",
                                        "CONTRACT_CAP_EXCEEDED"}:
            r.call("get_contract_terms", vendor_id=vid)
            evidence.append(r.calls[-1]["ref"])
            proposals.append("request_corrected_invoice")
        elif case.case_type == "UNKNOWN_VENDOR":
            proposals.append("vendor_onboarding")
        elif case.case_type in {"NO_ELIGIBLE_RELEASER", "NO_ELIGIBLE_APPROVER"}:
            r.call("get_approval_history", invoice_id=inv_id)
            evidence.append(r.calls[-1]["ref"])
            proposals.append("escalate_to_controller")
        for f in ie[1:]:
            if f["code"] == case.case_type:
                lines.append(f"Rule result: {f['rationale']}")
                break
    except BudgetExhausted:
        complete = False
        questions.append("Lookup budget reached; investigation incomplete. Rule findings and Path to Pay unchanged.")
    return {"summary": " ".join(lines), "evidence": evidence, "proposed_actions": proposals,
            "open_questions": questions, "complete": complete}


def investigate(s: Session, actor: User, case: ResolutionCase, *, max_calls: int = MAX_CALLS,
                model_output: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run a bounded investigation. `model_output` lets tests inject a (possibly bad) model answer
    to exercise the fact check without calling any provider."""
    if actor.kind == "human" and actor.role == "employee":
        raise Forbidden("ROLE_NOT_PERMITTED", "Employees cannot run investigations.")
    r = Runner(s, actor, case, max_calls=max_calls)
    template = _deterministic(r)
    source, rejected = "deterministic_template", None
    candidate = model_output
    if candidate is None:
        try:
            candidate = ai_gateway.complete(PROMPT_VERSION, {"case_id": case.id, "results": r.results})
        except ai_gateway.AIUnavailable as e:
            rejected = str(e)
    if candidate is not None:
        keys = {"summary", "evidence", "proposed_actions", "open_questions", "complete"}
        unsupported = numbers_supported(str(candidate.get("summary", "")), r.results)
        bad_refs = [e for e in candidate.get("evidence", []) if e not in r.results]
        bad_actions = [a for a in candidate.get("proposed_actions", []) if a not in ALLOWED_PROPOSALS]
        if set(candidate) != keys or unsupported or bad_refs or bad_actions:
            rejected = (f"Model output rejected by validation: unsupported numbers {unsupported}, "
                        f"unknown evidence {bad_refs}, disallowed actions {bad_actions}.")
        else:
            template, source = candidate, "model"
    out = {**template, "source": source, "rejected_reason": rejected, "lookups": r.calls,
           "case_state_unchanged": True,
           "proposals_status": "PROPOSED — a person must accept; nothing was executed."}
    audit.record(s, actor=actor, action="investigation.completed", object_type="case", object_id=case.id,
                 invoice_id=case.invoice_id, result="INFO",
                 details={"source": source, "complete": out["complete"], "lookups": len(r.calls),
                          "rejected_reason": rejected, "proposed_actions": out["proposed_actions"]})
    return out
