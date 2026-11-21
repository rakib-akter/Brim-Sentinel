"""ApprovalPolicyService unit tests over the real users.csv (PRD §4A, P01–P13, five edge cases)."""
import csv
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.core.money import to_minor
from app.services.approval_policy import build_chain, eligible_releasers, release_authority_roles


@pytest.fixture(scope="module")
def users():
    out = {}
    with open(get_settings().data_dir / "data" / "users.csv") as fh:
        for r in csv.DictReader(fh):
            out[r["user_id"]] = SimpleNamespace(
                id=r["user_id"], role=r["role"], title=r["title"], status=r["status"],
                manager_id=r["manager_id"] or None, delegate_user_id=r["delegate_user_id"] or None,
                approval_limit_minor=to_minor(r["approval_limit_cad"]), kind="human")
    return out


def chain(users, cad, dept_mgr="U007", requester="U013", status="active", category=None, po_over=False):
    return build_chain(to_minor(str(cad)), dept_manager_id=dept_mgr, requester_id=requester, vendor_status=status,
                       vendor_category=category, po_over_balance=po_over, users=users)


def steps(r):
    return [(s.step_key, s.assigned_actor_id) for s in r.steps]


def test_p01_boundary_exactly_10k(users):
    assert steps(chain(users, "10000.00")) == [("dept_manager", "U007")]
    assert steps(chain(users, "10000.01")) == [("dept_manager", "U007"), ("finance_manager", "U003")]


def test_p03_p04_boundaries(users):
    assert [k for k, _ in steps(chain(users, "50000.00"))] == ["dept_manager", "finance_manager"]
    assert [k for k, _ in steps(chain(users, "50000.01"))] == ["dept_manager", "finance_manager", "controller_admin"]
    assert [k for k, _ in steps(chain(users, "250000.00"))][-1] == "controller_admin"
    r = chain(users, "250000.01")
    assert steps(r)[-1] == ("cfo", "U001")  # edge case 4: CFO mapped by title to U001


def test_release_authority_boundary_100k():
    assert release_authority_roles(to_minor("100000.00")) == ["finance_manager", "controller_admin"]
    assert release_authority_roles(to_minor("100000.01")) == ["controller_admin"]  # P10


def test_edge1_fm_approves_above_10k_so_controller_or_cfo_releases(users):  # AT-17
    r = chain(users, "15000")
    rel = eligible_releasers(to_minor("15000"), users, {s.assigned_actor_id for s in r.steps})
    assert "U003" not in rel and set(rel) == {"U001", "U002"}


def test_edge2_no_eligible_releaser_above_250k(users):  # AT-18
    r = chain(users, "300000")
    assert eligible_releasers(to_minor("300000"), users, {s.assigned_actor_id for s in r.steps}) == []


def test_edge3_delegate_collision_escalates_to_controller(users):  # AT-19
    r = chain(users, "15000", dept_mgr="U012", requester="U037")
    dept = r.steps[0]
    assert dept.assigned_actor_id == "U002" and "P08" in dept.policy_ids
    assert "U003" in dept.escalation_reason and "one person" in dept.escalation_reason
    assert r.steps[1].assigned_actor_id == "U003"
    assert len({s.assigned_actor_id for s in r.steps}) == len(r.steps)


def test_p08_delegate_used_when_no_collision(users):
    r = chain(users, "5000", dept_mgr="U012", requester="U037")
    assert steps(r) == [("dept_manager", "U003")] and r.steps[0].delegated_from_id == "U012"


def test_edge4_cfo_fail_closed(users):
    no_cfo = {k: v for k, v in users.items() if k != "U001"}
    r = chain(no_cfo, "300000")
    assert any(b["code"] == "NO_ELIGIBLE_APPROVER" and "CFO" in b["reason"] for b in r.blocking_codes)


def test_edge5_finance_manager_steps_merge(users):  # AT-20
    r = chain(users, "15000", category="Legal", status="pending_review", po_over=True)
    fm = [s for s in r.steps if s.step_key == "finance_manager"]
    assert len(fm) == 1 and fm[0].policy_ids == ["P02", "P05", "P06", "P12"]


def test_p05_p06_add_finance_manager_below_10k(users):
    assert steps(chain(users, "500", category="Legal"))[-1] == ("finance_manager", "U003")
    assert steps(chain(users, "500", status="pending_review"))[-1] == ("finance_manager", "U003")


def test_p07_requester_is_approver_escalates_to_manager(users):
    r = chain(users, "5000", dept_mgr="U007", requester="U007")
    assert steps(r) == [("dept_manager", "U001")] and "P07" in r.steps[0].policy_ids


def test_terminated_approver_never_assigned(users):
    for cad in ("500", "20000", "60000", "300000"):
        r = chain(users, cad, requester="U015")
        assert "U015" not in {s.assigned_actor_id for s in r.steps}


def test_amount_above_all_limits_has_no_approver(users):
    assert any(b["code"] == "NO_ELIGIBLE_APPROVER" for b in chain(users, "500000.01").blocking_codes)
