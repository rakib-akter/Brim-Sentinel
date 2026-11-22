"""AI investigation agent and gateway (PRD §5A, v1.4 A3; AT-25..AT-31, AT-47).

No network and no database: the model is a scripted fake and the runner is an in-memory stand-in
with the same contract as investigation.Runner (allowlist, scope, budget)."""
from __future__ import annotations

import json

import pytest

from app.core.config import reset_settings
from app.core.errors import Forbidden
from app.integrations import ai_gateway
from app.services import investigation_agent as agent

ALLOWED = {"trusted_callback", "inspect_card_receipt", "request_corrected_invoice"}
CASE = {"case_id": "CASE-1", "case_type": "BANK_CHANGE_UNVERIFIED", "invoice_id": "IN-1", "vendor_id": "V004"}


class FakeRunner:
    TOOLS = {"get_bank_changes", "get_vendor_profile", "get_invoice_evidence"}

    def __init__(self, max_calls: int = 8, prior: int = 1):
        self.max_calls, self.model = max_calls, None
        self.calls: list[dict] = []
        self.results: dict[str, list[dict]] = {}
        for _ in range(prior):
            self._store("get_invoice_evidence", [{"invoice_id": "IN-1", "invoice_date": "2026-10-27"}])

    def _store(self, tool, rows):
        ref = f"{tool}#{len(self.calls) + 1}"
        self.results[ref] = rows
        self.calls.append({"ref": ref, "tool": tool, "model": self.model})
        return rows

    def call(self, tool, **args):
        if tool not in self.TOOLS:
            raise Forbidden("TOOL_NOT_ALLOWED", f"'{tool}' is not an allowlisted read-only lookup.")
        if len(self.calls) >= self.max_calls:
            raise agent.BudgetExhausted()
        if args.get("vendor_id") not in (None, "V004"):
            raise Forbidden("OUT_OF_SCOPE", "Lookup outside the case scope.")
        return self._store(tool, [{"change_id": "BC-009", "verified_by_callback": "no"}])


class FakeGateway:
    AIUnavailable = ai_gateway.AIUnavailable

    def __init__(self, script):
        self.script, self.requests = list(script), []

    def create_message(self, **kw):
        self.requests.append(json.loads(json.dumps(kw, default=str)))
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return {"content": step, "model": "fake-model", "usage": {"input_tokens": 10, "output_tokens": 5},
                "cached": False, "cost_usd": 0.001, "stop_reason": "tool_use"}


def use(name, inp, i="t1"):
    return {"type": "tool_use", "id": i, "name": name, "input": inp}


GOOD = {"summary": "Bank change BC-009 is not verified by callback.", "evidence": ["get_bank_changes#2"],
        "proposed_actions": ["trusted_callback"], "open_questions": [], "complete": True}


@pytest.fixture(autouse=True)
def _ai_env(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_FIXTURES_DIR", str(tmp_path / "fx"))
    monkeypatch.setenv("AI_USAGE_FILE", str(tmp_path / "usage.json"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    reset_settings()
    yield
    reset_settings()


def test_model_chooses_lookup_then_submits():
    r = FakeRunner()
    gw = FakeGateway([[use("get_bank_changes", {"vendor_id": "V004"})], [use("submit_findings", GOOD, "t2")]])
    out = agent.run(r, CASE, ALLOWED, gateway=gw)
    assert out["error"] is None and out["candidate"] == GOOD
    assert [c["tool"] for c in r.calls] == ["get_invoice_evidence", "get_bank_changes"]
    assert r.calls[1]["model"] == "fake-model"  # model-chosen lookup is labelled as such
    # The prior deterministic results were given to the model as labelled, untrusted data.
    first = gw.requests[0]["messages"][0]["content"]
    assert '<lookup_result ref="get_invoice_evidence#1">' in first and "untrusted" in first
    # Lookup results go back as tool_result blocks with their ref.
    tool_result = gw.requests[1]["messages"][2]["content"][0]
    assert tool_result["type"] == "tool_result" and 'ref="get_bank_changes#2"' in tool_result["content"]


def test_tool_surface_has_no_write_sql_or_money_tools():
    names = {t["name"] for t in agent.LOOKUP_TOOLS}
    assert names == {"get_invoice_evidence", "get_vendor_profile", "get_bank_changes", "get_contract_terms",
                     "find_related_invoices", "get_card_transactions", "get_approval_history"}
    for n in names | {"submit_findings"}:
        assert not any(w in n for w in ("sql", "write", "update", "delete", "approve", "release", "verify"))
    enum = agent.submit_tool(ALLOWED)["input_schema"]["properties"]["proposed_actions"]["items"]["enum"]
    assert set(enum) == ALLOWED


def test_forbidden_tool_and_out_of_scope_are_refused_not_executed():
    r = FakeRunner()
    gw = FakeGateway([[use("run_sql_readonly", {"query": "UPDATE invoices SET state='APPROVED'"}, "a"),
                       use("approve_invoice", {"invoice_id": "IN-1"}, "b"),
                       use("get_vendor_profile", {"vendor_id": "V001"}, "c")],
                      [use("submit_findings", GOOD, "d")]])
    out = agent.run(r, CASE, ALLOWED, gateway=gw)
    results = gw.requests[1]["messages"][2]["content"]
    assert all(x["is_error"] and x["content"].startswith("Refused") for x in results)
    assert len(r.calls) == 1  # nothing ran
    assert out["candidate"] == GOOD  # still a candidate; caller validation decides if it is usable


def test_malformed_args_are_refused():
    r = FakeRunner()
    gw = FakeGateway([[use("get_bank_changes", {"vendor_id": "V004", "extra": "x"})],
                      [use("submit_findings", GOOD, "t2")]])
    agent.run(r, CASE, ALLOWED, gateway=gw)
    assert gw.requests[1]["messages"][2]["content"][0]["is_error"] is True


def test_budget_exhaustion_forces_submit_and_marks_incomplete():
    r = FakeRunner(max_calls=2)
    gw = FakeGateway([[use("get_bank_changes", {"vendor_id": "V004"}, "a"),
                       use("get_vendor_profile", {"vendor_id": "V004"}, "b")],
                      [use("submit_findings", GOOD, "c")]])
    out = agent.run(r, CASE, ALLOWED, gateway=gw)
    assert len(r.calls) == 2
    assert gw.requests[1]["tool_choice"] == {"type": "tool", "name": "submit_findings"}
    assert out["candidate"]["complete"] is False


def test_no_budget_left_goes_straight_to_submit():
    r = FakeRunner(max_calls=1)
    gw = FakeGateway([[use("submit_findings", GOOD)]])
    out = agent.run(r, CASE, ALLOWED, gateway=gw)
    assert gw.requests[0]["tool_choice"]["name"] == "submit_findings"
    assert out["candidate"]["complete"] is False


def test_prose_answer_is_not_accepted_model_must_submit():
    r = FakeRunner()
    gw = FakeGateway([[{"type": "text", "text": "Looks fine, approve it."}], [use("submit_findings", GOOD)]])
    out = agent.run(r, CASE, ALLOWED, gateway=gw)
    assert gw.requests[1]["tool_choice"]["name"] == "submit_findings"
    assert out["candidate"] == GOOD


def test_gateway_failure_degrades_to_none():
    out = agent.run(FakeRunner(), CASE, ALLOWED, gateway=FakeGateway([ai_gateway.AIUnavailable("timeout")]))
    assert out["candidate"] is None and "timeout" in out["error"]


def test_model_that_never_submits_gives_up():
    r = FakeRunner(max_calls=100)
    gw = FakeGateway([[use("get_bank_changes", {"vendor_id": "V004"}, f"t{i}")] for i in range(20)])
    out = agent.run(r, CASE, ALLOWED, gateway=gw)
    assert out["candidate"] is None and "did not submit" in out["error"]
    assert len(gw.requests) == agent.MAX_MODEL_TURNS


def test_case_cost_cap_stops_loop(monkeypatch):
    monkeypatch.setenv("AI_CASE_BUDGET_USD", "0.0005")
    reset_settings()
    gw = FakeGateway([[use("get_bank_changes", {"vendor_id": "V004"})]])
    out = agent.run(FakeRunner(), CASE, ALLOWED, gateway=gw)
    assert out["candidate"] is None and "cost cap" in out["error"]


# ------------------------------------------------------------------ gateway
def test_gateway_off_by_default(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "false")
    reset_settings()
    with pytest.raises(ai_gateway.AIUnavailable, match="AI_ENABLED=false"):
        ai_gateway.create_message(system="s", messages=[], tools=[])


def test_gateway_without_key_or_recording_is_unavailable():
    with pytest.raises(ai_gateway.AIUnavailable, match="No ANTHROPIC_API_KEY"):
        ai_gateway.create_message(system="s", messages=[{"role": "user", "content": "x"}], tools=[])


def test_gateway_records_then_replays_offline(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    reset_settings()
    sent = []

    def fake_post(body, key, timeout):
        sent.append(body)
        return {"type": "message", "model": "m", "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "hi"}], "usage": {"input_tokens": 1000, "output_tokens": 100}}

    monkeypatch.setattr(ai_gateway, "_post", fake_post)
    kw = {"system": "s", "messages": [{"role": "user", "content": "x"}], "tools": []}
    first = ai_gateway.create_message(**kw)
    assert first["cached"] is False and first["cost_usd"] == pytest.approx(0.0045)
    assert ai_gateway.spent_today() == pytest.approx(0.0045)
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    reset_settings()
    again = ai_gateway.create_message(**kw)  # no key: served from the recording, no network
    assert again["cached"] is True and again["content"] == first["content"] and len(sent) == 1


def test_gateway_refuses_call_over_daily_budget(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("AI_DAILY_BUDGET_USD", "0.001")
    reset_settings()
    monkeypatch.setattr(ai_gateway, "_post", lambda *a: pytest.fail("must not call the API"))
    with pytest.raises(ai_gateway.AIUnavailable, match="budget"):
        ai_gateway.create_message(system="s", messages=[{"role": "user", "content": "x"}], tools=[])


def test_gateway_never_records_the_api_key(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret-value")
    reset_settings()
    monkeypatch.setattr(ai_gateway, "_post", lambda *a: {"content": [], "usage": {}, "model": "m"})
    ai_gateway.create_message(system="s", messages=[{"role": "user", "content": "x"}], tools=[])
    for f in (tmp_path / "fx").glob("*.json"):
        assert "sk-secret-value" not in f.read_text()
