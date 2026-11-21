"""AT-25..AT-31, AT-47: bounded read-only investigation with deterministic fallback."""
from app.db.models import ResolutionCase
from app.services import investigation
from tests.conftest import H, inv


def _cascadia_case(client):
    d = inv(client, "IN-EM-019-1")
    return next(c for c in d["resolution_cases"] if c["case_type"] == "BANK_CHANGE_UNVERIFIED")


def test_at25_cascadia_cites_bc009_and_same_day(client):
    c = _cascadia_case(client)
    before = inv(client, "IN-EM-019-1")
    r = client.post(f"/api/v1/cases/{c['id']}/investigate", headers=H("U004"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert "BC-009" in out["summary"] and "email_request" in out["summary"]
    assert "same day" in out["summary"] and "2026-10-27" in out["summary"]
    assert out["evidence"] and all(e in {x["ref"] for x in out["lookups"]} for e in out["evidence"])
    assert out["source"] == "deterministic_template"  # AT-30: AI off → deterministic, case still works
    assert "****9679" in out["summary"] and "953389679" not in str(out)  # masked bank data
    after = inv(client, "IN-EM-019-1")
    assert after["lifecycle_state"] == before["lifecycle_state"] == "ON_HOLD"  # hold never touched


def test_at26_at47_tool_surface_is_fixed_and_read_only():
    assert set(investigation.TOOLS) == {"get_invoice_evidence", "get_vendor_profile", "get_bank_changes",
                                        "get_contract_terms", "find_related_invoices", "get_card_transactions",
                                        "get_approval_history"}
    for name in investigation.TOOLS:
        assert not any(w in name for w in ("sql", "write", "update", "delete", "approve", "release", "verify"))


def test_tool_rejects_unknown_tool_sql_and_out_of_scope(session):
    from app.core.errors import Forbidden
    from app.db.models import User

    case = session.query(ResolutionCase).filter_by(case_type="BANK_CHANGE_UNVERIFIED").first()
    r = investigation.Runner(session, session.get(User, "U004"), case)
    for bad in ("run_sql_readonly", "propose_resolution", "approve_invoice"):
        try:
            r.call(bad, query="UPDATE invoices SET lifecycle_state='APPROVED'")
            raise AssertionError("should fail")
        except Forbidden:
            pass
    try:
        r.call("get_vendor_profile", vendor_id="V001")  # another vendor: outside case scope
        raise AssertionError("should fail")
    except Forbidden:
        pass
    try:
        r.call("get_bank_changes", vendor_id="V004'; DROP TABLE x;--")
        raise AssertionError("should fail")
    except ValueError:
        pass


def test_at27_call_budget_marks_incomplete(session):
    from app.db.models import User

    case = session.query(ResolutionCase).filter_by(case_type="BANK_CHANGE_UNVERIFIED").first()
    out = investigation.investigate(session, session.get(User, "U004"), case, max_calls=1)
    assert out["complete"] is False and len(out["lookups"]) == 1
    assert case.state == "AWAITING_VERIFICATION"  # rule findings and Path to Pay unchanged


def test_at28_unsupported_number_rejected(session):
    from app.db.models import User

    case = session.query(ResolutionCase).filter_by(case_type="BANK_CHANGE_UNVERIFIED").first()
    bad = {"summary": "Supplier was paid 987,654.32 last week.", "evidence": [], "proposed_actions": [],
           "open_questions": [], "complete": True}
    out = investigation.investigate(session, session.get(User, "U004"), case, model_output=bad)
    assert out["source"] == "deterministic_template" and "987,654.32" in out["rejected_reason"]
    bad2 = {**bad, "summary": "Looks fine.", "proposed_actions": ["release_payment"]}
    out2 = investigation.investigate(session, session.get(User, "U004"), case, model_output=bad2)
    assert out2["source"] == "deterministic_template" and "release_payment" in out2["rejected_reason"]


def test_at31_lookups_in_flight_recorder(client):
    c = _cascadia_case(client)
    out = client.post(f"/api/v1/cases/{c['id']}/investigate", headers=H("U004")).json()
    fr = client.get("/api/v1/invoices/IN-EM-019-1/flight-recorder", headers=H("U006")).json()
    looks = [e for e in fr["events"] if e["action"] == "investigation.lookup"]
    assert len(looks) == len(out["lookups"]) >= 2


def test_employee_cannot_investigate(client):
    c = _cascadia_case(client)
    # Operations employee U013 cannot see it as requester? Use the invoice's requester for scope.
    req = inv(client, "IN-EM-019-1")["requester_id"]
    r = client.post(f"/api/v1/cases/{c['id']}/investigate", headers=H(req))
    assert r.status_code == 403
