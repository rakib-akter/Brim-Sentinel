"""ResolutionService: persistent, evidence-linked cases with a deterministic Path to Pay.

A case is created/updated for every blocking FAIL/UNKNOWN finding code on the current version.
It is RESOLVED only by deterministic revalidation (the finding no longer blocks) or REJECTED by a
documented human decision — never because a model said so."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.core.permissions import require
from app.db.models import (
    Invoice,
    InvoiceVersion,
    ResolutionAction,
    ResolutionCase,
    User,
    ValidationFinding,
    VendorBankChange,
)
from app.services import audit, catalog
from app.services import policy_settings

CLOSED_STATES = {"RESOLVED", "REJECTED", "CANCELLED"}
INITIAL_STATE = {
    "BANK_CHANGE_UNVERIFIED": "AWAITING_VERIFICATION",
    "BANK_DETAILS_MISMATCH": "AWAITING_VERIFICATION",
    "UNKNOWN_VENDOR": "AWAITING_VERIFICATION",
    "VENDOR_TAX_ID_MISMATCH": "AWAITING_VERIFICATION",
    "DUPLICATE_VENDOR_IDENTITY": "INVESTIGATING",
    "PO_MISSING": "AWAITING_INFORMATION",
    "TAX_MISMATCH": "AWAITING_INFORMATION",
    "TOTALS_MISMATCH": "AWAITING_INFORMATION",
    "EXTRACTION_INCOMPLETE": "AWAITING_INFORMATION",
    "DEPARTMENT_UNASSIGNED": "AWAITING_INFORMATION",
    "NO_ELIGIBLE_RELEASER": "AWAITING_AUTHORIZATION",
    "NO_ELIGIBLE_APPROVER": "AWAITING_AUTHORIZATION",
    "DUPLICATE_INVOICE": "INVESTIGATING",
    "DUPLICATE_CANDIDATE": "INVESTIGATING",
    "CARD_PAID_DUPLICATE": "INVESTIGATING",
}
SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
ROLE_OWNER = {"finance_manager": "U003", "controller_admin": "U002"}


def _next_case_id(session: Session) -> str:
    n = session.scalar(select(func.count()).select_from(ResolutionCase)) or 0
    return f"CASE-{n + 1:05d}"


def sync_cases(session: Session, inv: Invoice, v: InvoiceVersion, findings: list[ValidationFinding],
               actor: User | None) -> list[ResolutionCase]:
    by_code: dict[str, list[ValidationFinding]] = {}
    for f in findings:
        if f.blocking and f.result in {"FAIL", "UNKNOWN"}:
            by_code.setdefault(f.code, []).append(f)
    open_cases = {c.case_type: c for c in session.scalars(select(ResolutionCase).where(
        ResolutionCase.invoice_id == inv.id, ResolutionCase.state.not_in(CLOSED_STATES)))}
    touched = []
    for code, fs in by_code.items():
        sev = max((f.severity for f in fs), key=lambda s: SEVERITY_RANK.get(s, 0))
        meta = catalog.info(code)
        bc_id = next((f.data.get("bank_change_id") for f in fs if f.data.get("bank_change_id")), None)
        case = open_cases.get(code)
        if case is None:
            case = ResolutionCase(id=_next_case_id(session), invoice_id=inv.id, invoice_version=v.version,
                                  case_type=code, state=INITIAL_STATE.get(code, "OPEN"), severity=sev,
                                  owner_role=meta.owner_role, owner_id=ROLE_OWNER.get(meta.owner_role),
                                  finding_ids=[f.id for f in fs], bank_change_id=bc_id)
            session.add(case)
            session.flush()
            audit.record(session, actor=actor, action="case.opened", object_type="case", object_id=case.id,
                         object_version=v.version, invoice_id=inv.id, after=case.state,
                         policy_ids=sorted({p for f in fs for p in f.policy_ids}),
                         evidence=[{"type": "finding", "ref": f.id} for f in fs], details={"case_type": code})
        else:
            case.invoice_version = v.version
            case.finding_ids = [f.id for f in fs]
            case.severity = sev
            case.bank_change_id = case.bank_change_id or bc_id
            case.row_version += 1
        touched.append(case)
    for code, case in open_cases.items():
        if code in by_code:
            continue
        dismissed = next((f for f in findings if f.code == code and f.dismissed_by), None)
        rerouted = next((f for f in findings if f.code == code and not f.blocking
                         and (f.data or {}).get("superseded_by_method_change")), None)
        before = case.state
        case.state = "RESOLVED"
        case.closure_outcome = (
            f"Dismissed by {dismissed.dismissed_by}: {dismissed.dismissal_reason}" if dismissed else
            f"Version {v.version} will be paid by the verified virtual-card route under method change "
            f"{rerouted.data['superseded_by_method_change']}; the bank change itself remains unverified and EFT stays "
            f"blocked." if rerouted else
            f"Deterministic revalidation of version {v.version} no longer finds {code}.")
        case.row_version += 1
        audit.record(session, actor=actor, action="case.resolved", object_type="case", object_id=case.id,
                     object_version=v.version, invoice_id=inv.id, before=before, after="RESOLVED",
                     details={"outcome": case.closure_outcome})
    session.flush()
    return touched


def _step(key: str, label: str, done: bool, role: str) -> dict[str, Any]:
    return {"key": key, "label": label, "status": "DONE" if done else "PENDING", "actor_role": role}


def path_to_pay(session: Session, case: ResolutionCase) -> list[dict[str, Any]]:
    inv = session.get(Invoice, case.invoice_id)
    state = inv.lifecycle_state if inv else ""
    resolved = case.state == "RESOLVED"
    approved = state in {"APPROVED", "SCHEDULED", "RELEASED", "SETTLED"}
    released = state in {"RELEASED", "SETTLED"}
    t = case.case_type
    steps = [_step("hold", "Payment paused (hold placed)", True, "system")]
    if t in {"BANK_CHANGE_UNVERIFIED", "BANK_DETAILS_MISMATCH"}:
        bc = session.get(VendorBankChange, case.bank_change_id) if case.bank_change_id else None
        bstate = bc.state if bc else ""
        steps += [
            _step("callback", "Call the supplier on a contact already on file and record the verification",
                  bstate in {"VERIFICATION_RECORDED", "PENDING_ROUTE_AUTHORIZATION", "AUTHORIZED",
                             "REVALIDATION_REQUIRED", "CLOSED"}, "ap_clerk"),
            _step("route_authorization", "Finance manager authorizes the new payment route (different person)",
                  bstate in {"AUTHORIZED", "REVALIDATION_REQUIRED", "CLOSED"}, "finance_manager"),
        ]
    elif t in {"CARD_PAID_DUPLICATE", "DUPLICATE_CANDIDATE", "DUPLICATE_INVOICE"}:
        steps += [_step("inspect", "Inspect the matching record / card transaction and receipt", resolved, "ap_clerk"),
                  _step("determination", "Finance records an evidence-backed determination (dismiss or cancel)",
                        resolved, "finance_manager")]
    elif t in {"CONTRACT_RATE_EXCEEDED", "FUEL_SURCHARGE_CAP_EXCEEDED", "CONTRACT_CAP_EXCEEDED", "CONTRACT_EXPIRED"}:
        steps += [_step("compare", "Compare billed lines with the contract terms", resolved, "ap_clerk"),
                  _step("correct", "Obtain a corrected invoice or a finance-approved exception", resolved,
                        "finance_manager")]
    elif t == "UNKNOWN_VENDOR":
        steps += [_step("onboard", "Submit vendor onboarding with identity documents", resolved, "ap_clerk"),
                  _step("verify", "Independent verification of supplier and bank details", resolved, "ap_clerk"),
                  _step("activate", "Finance activates the vendor (two-person control)", resolved, "finance_manager")]
    elif t in {"NO_ELIGIBLE_RELEASER", "NO_ELIGIBLE_APPROVER"}:
        steps += [_step("escalate", "Escalate the policy gap to the controller/CFO", case.state != "OPEN",
                        "controller_admin"),
                  _step("decision", "Documented controller/CFO decision (no release shortcut exists)",
                        case.state in CLOSED_STATES, "controller_admin")]
        for s in steps:
            s["note"] = "There is no override: an approver can never release (P11)."
        return _mark_current(steps)
    elif t == "PO_MISSING":
        steps += [_step("obtain_po", "Get the PO number from the requester", resolved, "ap_clerk"),
                  _step("add_po", "Add the PO to the invoice (creates a new version)", resolved, "ap_clerk")]
    else:
        steps += [_step("fix", catalog.info(t).next_action, resolved, catalog.info(t).owner_role)]
    steps += [_step("revalidate", "Re-run all checks on the current invoice version", resolved, "system"),
              _step("approvals", "Required approvals on the current version", approved, "approver"),
              _step("release", "Independent authorized person releases the SIMULATED payment", released,
                    "finance_manager/controller_admin")]
    return _mark_current(steps)


def _mark_current(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for s in steps:
        if s["status"] == "PENDING":
            s["status"] = "CURRENT"
            break
    return steps


DRAFT_TEMPLATES = {
    "PO_MISSING": "Hello, invoice {num} requires a purchase order number. Could you confirm the PO it should be "
                  "billed against? — Harborline AP",
    "TAX_MISMATCH": "Hello, the taxes on invoice {num} do not match the delivery province. Please issue a corrected "
                    "invoice. — Harborline AP",
    "TOTALS_MISMATCH": "Hello, the totals on invoice {num} do not reconcile. Please issue a corrected invoice. "
                       "— Harborline AP",
    "CONTRACT_RATE_EXCEEDED": "Hello, invoice {num} exceeds our contracted rate. Please issue a corrected invoice. "
                              "— Harborline AP",
    "FUEL_SURCHARGE_CAP_EXCEEDED": "Hello, the fuel surcharge on invoice {num} exceeds our contract cap. Please "
                                   "issue a corrected invoice. — Harborline AP",
}

ACTION_TYPES = {"note", "request_information", "escalate", "document_decision"}


def get_case(session: Session, case_id: str) -> ResolutionCase:
    c = session.get(ResolutionCase, case_id)
    if c is None:
        raise NotFound("CASE_NOT_FOUND", f"Case {case_id} not found.")
    return c


def add_action(session: Session, actor: User, case: ResolutionCase, *, action_type: str, notes: str | None,
               expected_row_version: int | None, decision: str | None = None) -> ResolutionAction:
    from app.services import lifecycle as lc

    if action_type not in ACTION_TYPES:
        raise Unprocessable("ACTION_TYPE_INVALID", f"Unsupported case action '{action_type}'.",
                            {"allowed": sorted(ACTION_TYPES)})
    if expected_row_version is not None and expected_row_version != case.row_version:
        raise Conflict("CASE_VERSION_CONFLICT", "This case changed. Refresh before continuing.",
                       {"expected": expected_row_version, "current": case.row_version})
    if case.state in CLOSED_STATES:
        raise Conflict("CASE_CLOSED", f"Case is {case.state}.")
    inv = session.get(Invoice, case.invoice_id)
    data: dict[str, Any] = {}
    status = "COMPLETED"
    if action_type == "document_decision":
        if actor.role != "controller_admin":
            raise Forbidden("ROLE_NOT_PERMITTED", "Only the controller/CFO can record a documented policy decision.")
        require(actor, "case.update")
        if decision not in {"reject_invoice", "keep_on_hold"}:
            raise Unprocessable("DECISION_INVALID", "decision must be 'reject_invoice' or 'keep_on_hold'. "
                                "There is no release override.", {"allowed": ["reject_invoice", "keep_on_hold"]})
        if not notes or len(notes.strip()) < 10:
            raise Unprocessable("REASON_REQUIRED", "A documented reason (≥ 10 characters) is required.")
        data["decision"] = decision
        if decision == "reject_invoice" and inv is not None:
            before = case.state
            lc.transition(session, inv, lc.REJECTED, actor=actor, reason=f"documented decision on {case.id}: {notes}")
            case.state = "REJECTED"
            case.closure_outcome = f"Rejected by {actor.id}: {notes}"
            audit.record(session, actor=actor, action="case.rejected", object_type="case", object_id=case.id,
                         object_version=case.invoice_version, invoice_id=case.invoice_id, before=before,
                         after="REJECTED", details={"reason": notes})
    else:
        require(actor, "case.update")
        if action_type == "request_information":
            status = "REQUESTED"
            v_num = None
            if inv is not None:
                from app.services.pipeline import current_version
                v_num = current_version(session, inv).invoice_number_raw
            data["draft_message"] = DRAFT_TEMPLATES.get(case.case_type, "Hello, we need more information about "
                                                        "invoice {num}. — Harborline AP").format(num=v_num or "?")
            data["sent"] = False
            data["note"] = "Draft only. A person must send it; Sentinel does not contact suppliers."
            case.state = "AWAITING_INFORMATION"
        elif action_type == "escalate":
            status = "REQUESTED"
            case.state = "AWAITING_AUTHORIZATION"
            case.owner_role, case.owner_id = "controller_admin", ROLE_OWNER["controller_admin"]
    act = ResolutionAction(id=f"RA-{case.id}-{(session.scalar(select(func.count()).select_from(ResolutionAction).where(ResolutionAction.case_id == case.id)) or 0) + 1:03d}",
                           case_id=case.id, action_type=action_type, status=status, actor_id=actor.id, notes=notes,
                           data=data)
    session.add(act)
    case.row_version += 1
    audit.record(session, actor=actor, action=f"case.action.{action_type}", object_type="case", object_id=case.id,
                 object_version=case.invoice_version, invoice_id=case.invoice_id, after=case.state,
                 details={"status": status, "notes": notes, **data})
    session.flush()
    return act


def case_actions(session: Session, case_id: str) -> list[ResolutionAction]:
    return list(session.scalars(select(ResolutionAction).where(ResolutionAction.case_id == case_id)
                                .order_by(ResolutionAction.created_at)))


def case_findings(session: Session, case: ResolutionCase) -> list[ValidationFinding]:
    if not case.finding_ids:
        return []
    return list(session.scalars(select(ValidationFinding).where(ValidationFinding.id.in_(case.finding_ids))))


def request_authorization(session: Session, actor: User, case: ResolutionCase, *, expected_invoice_version: int,
                          notes: str | None) -> ResolutionAction:
    """Wizard step 4. Records an authorization REQUEST listing the required approvers. It does not
    approve, verify or release anything; backend role/version gates still apply to each decision."""
    from app.services import approval_policy, pipeline

    require(actor, "case.authorization_request")
    inv = session.get(Invoice, case.invoice_id)
    if inv is None:
        raise NotFound("INVOICE_NOT_FOUND", "Invoice not found.")
    if expected_invoice_version != inv.current_version:
        raise Conflict("INVOICE_VERSION_CONFLICT", "This invoice changed. Refresh before continuing.",
                       {"expected_version": expected_invoice_version, "current_version": inv.current_version})
    reasons: list[str] = []
    if case.bank_change_id:
        bc = session.get(VendorBankChange, case.bank_change_id)
        if bc is None or bc.state not in {"AUTHORIZED", "REVALIDATION_REQUIRED", "CLOSED"}:
            reasons.append(f"Bank change {case.bank_change_id} is {bc.state if bc else 'missing'}: independent "
                           f"verification and finance route authorization are required first.")
    v = pipeline.current_version(session, inv)
    for f in pipeline.blocking_findings(session, inv.id, v.version):
        reasons.append(f"{f.code}: {f.title}")
    if inv.lifecycle_state not in {"PENDING_APPROVAL", "APPROVED"}:
        reasons.append(f"Invoice is {inv.lifecycle_state}.")
    if reasons:
        raise Unprocessable("AUTHORIZATION_PREREQUISITES_UNMET", "Payment stays on hold.",
                            {"blocked_reasons": sorted(set(reasons))})
    steps = pipeline.step_statuses(session, inv.id, v.version)
    users = pipeline.users_map(session)
    excluded = pipeline.release_exclusions(session, inv, v)
    data = {"approvers": [{"step": s.step_key, "assigned_actor_id": s.assigned_actor_id, "status": st,
                           "policy_ids": s.policy_ids} for s, st, _ in steps],
            "eligible_releasers": approval_policy.eligible_releasers(v.amount_cad_minor or 0, users, excluded,
                                                                    policy_settings.current(session)),
            "invoice_version": v.version,
            "note": "Request only — this does not approve or release. Each approver and the independent releaser "
                    "must act themselves."}
    act = ResolutionAction(id=f"RA-{case.id}-{(session.scalar(select(func.count()).select_from(ResolutionAction).where(ResolutionAction.case_id == case.id)) or 0) + 1:03d}",
                           case_id=case.id, action_type="authorization_request", status="REQUESTED",
                           actor_id=actor.id, notes=notes, data=data)
    session.add(act)
    case.row_version += 1
    audit.record(session, actor=actor, action="case.authorization_requested", object_type="case", object_id=case.id,
                 object_version=v.version, invoice_id=inv.id, details=data)
    session.flush()
    return act
