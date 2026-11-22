"""Editable approval policy and approver delegation (brief: "Let an admin edit the rules, handle
delegation and approver absence"; PRD FR-06, P08)."""
from sqlalchemy import select

from app.db.models import ApprovalDecision, ApprovalStep, AuditEvent, Invoice
from tests.conftest import H, inv

POLICY = "/api/v1/settings/approval-policy"
DEFAULTS = {"dept_manager_up_to_minor": 10_000_00, "controller_over_minor": 50_000_00,
            "cfo_over_minor": 250_000_00, "fm_release_up_to_minor": 100_000_00,
            "new_vendor_needs_fm": True, "legal_vendor_needs_fm": True}


def _patch(client, uid, values, version=0, reason="Tighter control for year-end"):
    return client.patch(POLICY, headers=H(uid), json={"expected_version": version, "values": values,
                                                      "reason": reason})


def _waiting_on(session, actor_id, max_amount=None):
    """An invoice waiting for approval whose undecided step is assigned to actor_id."""
    session.rollback()
    q = (select(Invoice, ApprovalStep)
         .join(ApprovalStep, (ApprovalStep.invoice_id == Invoice.id) & (ApprovalStep.version == Invoice.current_version))
         .where(Invoice.lifecycle_state == "PENDING_APPROVAL", ApprovalStep.assigned_actor_id == actor_id)
         .order_by(Invoice.id))
    for invoice, step in session.execute(q).all():
        decided = session.scalar(select(ApprovalDecision.id).where(ApprovalDecision.invoice_id == invoice.id))
        if decided is None:
            return invoice.id, step.step_key
    raise AssertionError(f"no pending approval for {actor_id} in the seeded data")


def _step(client, invoice_id, step_key, uid="U004"):
    return next(s for s in inv(client, invoice_id, uid)["approval_chain"] if s["step_key"] == step_key)


# ------------------------------------------------------------------ approval policy
def test_everyone_can_read_the_rules_only_the_controller_can_edit(client):
    r = client.get(POLICY, headers=H("U004"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == 0 and body["values"] == DEFAULTS and body["can_edit"] is False
    assert [x["id"] for x in body["rules"]] == [f"P{n:02d}" for n in range(1, 14)]
    locked = {x["id"] for x in body["rules"] if x["editable"] == "locked"}
    assert {"P07", "P11", "P12", "P13"} <= locked
    assert client.get(POLICY, headers=H("U002")).json()["can_edit"] is True
    for uid in ("U003", "U004", "U007", "U006"):  # finance manager, AP clerk, approver, auditor
        assert _patch(client, uid, {**DEFAULTS, "dept_manager_up_to_minor": 5_000_00}).status_code == 403


def test_rules_cannot_be_loosened_misordered_stale_or_unexplained(client):
    too_loose = _patch(client, "U002", {**DEFAULTS, "dept_manager_up_to_minor": 20_000_00})
    assert too_loose.status_code == 422 and too_loose.json()["error"]["code"] == "POLICY_INVALID"
    misordered = _patch(client, "U002", {**DEFAULTS, "dept_manager_up_to_minor": 9_000_00,
                                         "controller_over_minor": 5_000_00})
    assert misordered.status_code == 422
    assert _patch(client, "U002", {**DEFAULTS, "fm_release_up_to_minor": 50_000_00}, version=3).status_code == 409
    assert _patch(client, "U002", {**DEFAULTS, "fm_release_up_to_minor": 50_000_00}, reason="  ").status_code == 422
    assert _patch(client, "U002", {**DEFAULTS, "verified": True}).status_code == 422  # unknown field rejected
    assert client.get(POLICY, headers=H("U004")).json()["version"] == 0  # nothing changed


def test_tighter_threshold_reroutes_open_invoices_and_is_audited(client, session):
    target, _ = _waiting_on(session, "U007")
    amount = inv(client, target)["amount_cad_minor"]
    assert 200_00 < amount <= 10_000_00
    assert [s["step_key"] for s in inv(client, target)["approval_chain"]] == ["dept_manager"]
    threshold = max(100_00, amount // 2)  # strictly below this invoice, at or above the CAD 100 floor
    r = _patch(client, "U002", {**DEFAULTS, "dept_manager_up_to_minor": threshold})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == 1 and body["updated_by"] == "U002" and target in body["rerouted_invoice_ids"]
    assert body["changed"] == {"dept_manager_up_to_minor": {"before": 10_000_00, "after": threshold}}
    chain = inv(client, target)["approval_chain"]
    assert [s["step_key"] for s in chain] == ["dept_manager", "finance_manager"]
    assert "P02" in chain[1]["trigger_policy_ids"]
    session.rollback()
    ev = session.scalars(select(AuditEvent).where(AuditEvent.action == "policy.updated")).all()
    assert len(ev) == 1 and ev[0].actor_id == "U002" and ev[0].details["reason"]


def test_unchanged_policy_is_a_no_op(client):
    r = _patch(client, "U002", DEFAULTS)
    assert r.status_code == 200 and r.json()["version"] == 0 and r.json()["rerouted_invoice_ids"] == []


# ------------------------------------------------------------------ delegation while away
def test_approver_away_moves_pending_steps_to_delegate_and_back(client, session):
    target, step_key = _waiting_on(session, "U007")
    r = client.post("/api/v1/users/U007/away", headers=H("U007"),
                    json={"delegate_user_id": "U008", "note": "Conference"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["status"] == "on_leave" and r.json()["user"]["delegate_user_id"] == "U008"
    assert target in r.json()["rerouted_invoice_ids"]
    step = _step(client, target, step_key)
    assert step["assigned_actor_id"] == "U008" and step["delegated_from_id"] == "U007"
    assert "P08" in step["trigger_policy_ids"]
    # Away approvers cannot approve; the delegate's identity is recorded on the step.
    d = inv(client, target)
    deny = client.post(f"/api/v1/invoices/{target}/approvals/{step_key}/decision", headers=H("U007"),
                       json={"expected_version": d["version"], "decision": "APPROVED"})
    assert deny.status_code == 403
    back = client.post("/api/v1/users/U007/back", headers=H("U007"))
    assert back.status_code == 200, back.text
    assert back.json()["user"]["status"] == "active" and back.json()["user"]["delegate_user_id"] is None
    step = _step(client, target, step_key)
    assert step["assigned_actor_id"] == "U007" and step["delegated_from_id"] is None
    session.rollback()
    actions = [e.action for e in session.scalars(select(AuditEvent).where(AuditEvent.object_id == "U007"))]
    assert "user.away_started" in actions and "user.away_ended" in actions


def test_delegation_rules(client):
    away = lambda who, uid, delegate: client.post(f"/api/v1/users/{who}/away", headers=H(uid),  # noqa: E731
                                                  json={"delegate_user_id": delegate})
    assert away("U007", "U008", "U009").status_code == 403          # can't set someone else away
    assert away("U007", "U007", "U007").status_code == 422          # not your own delegate
    assert away("U007", "U007", "U013").status_code == 422          # delegate must approve invoices
    assert away("U007", "U007", "U012").status_code == 422          # delegate must be available (U012 on leave)
    assert away("U007", "U007", "NOPE").status_code == 422          # unknown delegate
    assert away("U004", "U004", "U007").status_code == 422          # AP clerks don't approve
    assert client.post("/api/v1/users/U007/back", headers=H("U007")).status_code == 409  # not away
    assert away("U009", "U002", "U008").status_code == 200          # controller can set anyone
    assert client.post("/api/v1/users/U009/back", headers=H("U002")).status_code == 200


def test_dataset_absence_can_be_ended_by_the_person(client):
    # U012 is on leave in the dataset (delegate U003); they can mark themselves back.
    r = client.post("/api/v1/users/U012/back", headers=H("U012"))
    assert r.status_code == 200, r.text
    assert r.json()["user"]["status"] == "active"
