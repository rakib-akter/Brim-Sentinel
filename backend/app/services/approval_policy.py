"""ApprovalPolicyService: deterministic approval chain + releaser eligibility (PRD §4A, P01–P13).

Pure functions over plain user records, so every rule and edge case is unit-testable:
 1. Finance-manager release is the exception above CAD 10k (P02 + P11).
 2. Above CAD 250k both controller_admin users approve → NO_ELIGIBLE_RELEASER (never bypassed).
 3. One person fills at most one step per version; a delegated duplicate escalates to the controller.
 4. CFO step maps to the controller_admin titled "Chief Financial Officer"; fail closed if absent.
 5. Duplicate finance-manager steps (P02/P05/P06/P12) merge, keeping every triggering policy ID.
Thresholds compare integer CAD minor units; "over" means strictly greater than."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.core.money import CAD_10K, CAD_50K, CAD_100K, CAD_250K, CAD_500K

CFO_TITLE = "Chief Financial Officer"
STEP_ORDER = ["dept_manager", "finance_manager", "controller_admin", "cfo"]
STEP_CEILING = {"dept_manager": CAD_10K, "finance_manager": CAD_50K, "controller_admin": CAD_250K, "cfo": CAD_500K}


class UserLike(Protocol):
    id: str
    role: str
    title: str
    status: str
    manager_id: str | None
    delegate_user_id: str | None
    approval_limit_minor: int
    kind: str


@dataclass
class StepPlan:
    step_key: str
    required_role: str
    policy_ids: list[str]
    authority_ceiling_minor: int
    assigned_actor_id: str | None = None
    delegated_from_id: str | None = None
    escalation_reason: str | None = None
    notes: list[str] = field(default_factory=list)


@dataclass
class ChainResult:
    steps: list[StepPlan]
    blocking_codes: list[dict]  # [{"code": "NO_ELIGIBLE_APPROVER", "reason": ...}]


def required_steps(amount_cad_minor: int, *, vendor_status: str | None, vendor_category: str | None,
                   po_over_balance: bool) -> list[StepPlan]:
    a = amount_cad_minor
    dept_pols = ["P01"] if a <= CAD_10K else ["P02"] + (["P03"] if a > CAD_50K else []) + (["P04"] if a > CAD_250K else [])
    fm_pols: list[str] = []
    if a > CAD_10K:
        fm_pols.append("P02")
    if vendor_status in {"pending_review", "new"}:
        fm_pols.append("P05")
    if (vendor_category or "").strip().lower() == "legal":
        fm_pols.append("P06")
    if po_over_balance:
        fm_pols.append("P12")
    steps = [StepPlan("dept_manager", "dept_manager", dept_pols, STEP_CEILING["dept_manager"])]
    if fm_pols:  # merged: one finance-manager step listing every triggering rule
        steps.append(StepPlan("finance_manager", "finance_manager", fm_pols, STEP_CEILING["finance_manager"]))
    if a > CAD_50K:
        steps.append(StepPlan("controller_admin", "controller_admin", ["P03"], STEP_CEILING["controller_admin"]))
    if a > CAD_250K:
        steps.append(StepPlan("cfo", "cfo (controller_admin titled CFO)", ["P04"], STEP_CEILING["cfo"]))
    return steps


def _active(u: UserLike | None) -> bool:
    return u is not None and u.kind == "human" and u.status == "active"


def find_cfo(users: dict[str, UserLike]) -> UserLike | None:
    c = [u for u in users.values() if u.role == "controller_admin" and u.title.strip() == CFO_TITLE]
    return c[0] if len(c) == 1 else None


def find_controller(users: dict[str, UserLike]) -> UserLike | None:
    c = sorted((u for u in users.values() if u.role == "controller_admin" and u.title.strip() != CFO_TITLE),
               key=lambda u: u.id)
    return c[0] if c else None


def find_finance_manager(users: dict[str, UserLike]) -> UserLike | None:
    c = sorted((u for u in users.values() if u.role == "finance_manager"), key=lambda u: u.id)
    return c[0] if c else None


def build_chain(amount_cad_minor: int, *, dept_manager_id: str | None, requester_id: str | None,
                vendor_status: str | None, vendor_category: str | None, po_over_balance: bool,
                users: dict[str, UserLike], maker_id: str | None = None) -> ChainResult:
    """`maker_id` is the person whose manual edit created this invoice version. Like the
    requester (P07) they may not approve it (maker-checker); their step escalates to their manager."""
    steps = required_steps(amount_cad_minor, vendor_status=vendor_status, vendor_category=vendor_category,
                           po_over_balance=po_over_balance)
    blocking: list[dict] = []
    if amount_cad_minor > CAD_500K:
        blocking.append({"code": "NO_ELIGIBLE_APPROVER",
                         "reason": "Amount exceeds the highest individual approval limit (CFO CAD 500,000)."})
    controller, cfo, fm = find_controller(users), find_cfo(users), find_finance_manager(users)
    primary = {
        "dept_manager": users.get(dept_manager_id) if dept_manager_id else None,
        "finance_manager": fm,
        "controller_admin": controller,
        "cfo": cfo,
    }
    used: dict[str, str] = {}

    def ladder_for(step: StepPlan) -> list[UserLike | None]:
        idx = STEP_ORDER.index(step.step_key)
        higher = {"finance_manager": fm, "controller_admin": controller, "cfo": cfo}
        # Escalation goes to the next level(s) above this step (edge case 3 → controller).
        return [higher[k] for k in STEP_ORDER[max(idx + 1, 2):] if k in higher]

    def try_assign(step: StepPlan, candidate: UserLike | None, reason: str | None) -> bool:
        if not _active(candidate):
            return False
        assert candidate is not None
        if candidate.id in {requester_id, maker_id} - {None} or candidate.id in used:
            return False
        if candidate.approval_limit_minor < min(amount_cad_minor, step.authority_ceiling_minor):
            return False
        step.assigned_actor_id = candidate.id
        used[candidate.id] = step.step_key
        if reason:
            step.escalation_reason = reason
        return True

    # Fixed-role steps first so the flexible department step yields on collisions (edge case 3).
    order = [s for s in steps if s.step_key != "dept_manager"] + [s for s in steps if s.step_key == "dept_manager"]
    for step in order:
        p = primary[step.step_key]
        if step.step_key == "cfo" and p is None:
            blocking.append({"code": "NO_ELIGIBLE_APPROVER",
                             "reason": "CFO step (P04) requires exactly one controller_admin titled "
                                       "'Chief Financial Officer'; none found (fail closed)."})
            continue
        if p is None:
            blocking.append({"code": "NO_ELIGIBLE_APPROVER", "reason": f"No user found for step {step.step_key}."})
            continue
        reasons: list[str] = []
        candidate = p
        if p.status == "on_leave":
            d = users.get(p.delegate_user_id) if p.delegate_user_id else None
            if _active(d):
                step.delegated_from_id = p.id
                if "P08" not in step.policy_ids:
                    step.policy_ids.append("P08")
                reasons.append(f"{p.id} on leave; delegated to {d.id} (P08).")
                candidate = d
            else:
                reasons.append(f"{p.id} on leave with no active delegate.")
                candidate = None
        elif p.status == "terminated":
            reasons.append(f"{p.id} is terminated and cannot act.")
            candidate = None
        if candidate is not None and candidate.id == requester_id:
            if "P07" not in step.policy_ids:
                step.policy_ids.append("P07")
            reasons.append(f"{candidate.id} is the requester; self-approval not allowed (P07), escalating to manager.")
            mgr = users.get(candidate.manager_id) if candidate.manager_id else None
            if try_assign(step, mgr, " ".join(reasons)):
                step.delegated_from_id = None
                continue
            candidate = None
        if candidate is not None and maker_id and candidate.id == maker_id:
            reasons.append(f"{candidate.id} made the edits that created this invoice version; maker-checker forbids "
                           f"approving their own change, escalating to manager.")
            mgr = users.get(candidate.manager_id) if candidate.manager_id else None
            if try_assign(step, mgr, " ".join(reasons)):
                step.delegated_from_id = None
                continue
            candidate = None
        if candidate is not None and candidate.id in used:
            reasons.append(f"{candidate.id} already fills the {used[candidate.id]} step; one person may fill at "
                           f"most one step per invoice version, escalating to the next level.")
            step.delegated_from_id = None
            candidate = None
        if candidate is not None and try_assign(step, candidate, " ".join(reasons) or None):
            continue
        if candidate is not None:
            reasons.append(f"{candidate.id} is not eligible (limit or status); escalating.")
        assigned = False
        for alt in ladder_for(step):
            if try_assign(step, alt, " ".join(reasons + [f"Escalated to {alt.id if alt else '?'}."])):
                step.delegated_from_id = None
                assigned = True
                break
        if not assigned:
            blocking.append({"code": "NO_ELIGIBLE_APPROVER",
                             "reason": f"No eligible approver for step {step.step_key}: " + " ".join(reasons)})
    steps.sort(key=lambda s: STEP_ORDER.index(s.step_key))
    return ChainResult(steps=steps, blocking_codes=blocking)


def release_authority_roles(amount_cad_minor: int) -> list[str]:
    """P09: ≤ CAD 100k finance_manager (or a non-approving higher authority); P10: > CAD 100k controller_admin."""
    return ["finance_manager", "controller_admin"] if amount_cad_minor <= CAD_100K else ["controller_admin"]


def eligible_releasers(amount_cad_minor: int, users: dict[str, UserLike], excluded_ids: set[str]) -> list[str]:
    roles = release_authority_roles(amount_cad_minor)
    out = [u for u in users.values() if _active(u) and u.role in roles and u.id not in excluded_ids]
    out.sort(key=lambda u: (roles.index(u.role), u.id))
    return [u.id for u in out]
