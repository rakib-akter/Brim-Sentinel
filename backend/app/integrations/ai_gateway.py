"""The ONLY module allowed to call a model (ARCHITECTURE §3 rule 3, §9).

* OFF by default (`AI_ENABLED=false`): every call raises `AIUnavailable` and callers fall back to the
  deterministic template. Tests and the default demo never contact a provider.
* Replay: each response is saved under `fixtures/ai/<sha256>.json`, keyed by model + system prompt +
  messages + tools. With `AI_FIXTURE_REPLAY=true` a saved response is returned without a network call,
  so a recorded demo runs offline with zero credits. No key and no saved response → unavailable.
* Cost controls: per-call `max_tokens`, a per-day USD budget persisted in `AI_USAGE_FILE`, and a
  pre-call worst-case estimate that refuses a call which could exceed the day's budget.
* Nothing here can read or change application state. It sends already-fetched, masked lookup results
  and returns untrusted content that InvestigationService schema- and fact-checks.
* Standard library only (urllib): no SDK dependency to install.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from app.core.config import get_settings

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
_lock = threading.Lock()


class AIUnavailable(Exception):
    """AI is off, unconfigured, over budget or failed. Callers must degrade to deterministic output."""


def cache_key(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _fixture_path(key: str) -> Path:
    return get_settings().ai_fixtures_dir / f"{key}.json"


def _usage() -> dict[str, float]:
    p = get_settings().ai_usage_file
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return {}


def spent_today() -> float:
    return float(_usage().get(dt.date.today().isoformat(), 0.0))


def _record_spend(usd: float) -> None:
    p = get_settings().ai_usage_file
    with _lock:
        data = _usage()
        day = dt.date.today().isoformat()
        data[day] = round(float(data.get(day, 0.0)) + usd, 6)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, indent=1))


def estimate_cost(input_tokens: int, output_tokens: int) -> float:
    st = get_settings()
    return (input_tokens * st.ai_input_usd_per_mtok + output_tokens * st.ai_output_usd_per_mtok) / 1_000_000


def _post(body: dict[str, Any], api_key: str, timeout: float) -> dict[str, Any]:
    req = urllib.request.Request(
        API_URL, data=json.dumps(body).encode(), method="POST",
        headers={"x-api-key": api_key, "anthropic-version": API_VERSION, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (fixed https URL)
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise AIUnavailable(f"Model API returned HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        raise AIUnavailable(f"Model API unreachable: {e}") from e


def create_message(*, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]],
                   tool_choice: dict[str, Any] | None = None, max_tokens: int = 1200) -> dict[str, Any]:
    """One Messages API call. Returns {content, stop_reason, usage, model, cached, cost_usd}.
    Raises AIUnavailable for anything that is not a usable response."""
    st = get_settings()
    if not st.ai_enabled:
        raise AIUnavailable("AI_ENABLED=false (default). Deterministic investigation used.")
    body: dict[str, Any] = {"model": st.ai_model, "max_tokens": max_tokens, "system": system,
                            "messages": messages, "tools": tools}
    if tool_choice:
        body["tool_choice"] = tool_choice
    key = cache_key(body)
    path = _fixture_path(key)
    if st.ai_fixture_replay and path.exists():
        saved = json.loads(path.read_text())
        return {**saved, "cached": True, "cost_usd": 0.0}
    if not st.anthropic_api_key:
        raise AIUnavailable("No ANTHROPIC_API_KEY and no recorded response for this request.")
    # Refuse a call whose worst case (prompt size estimate + max_tokens) could exceed the daily budget.
    worst = estimate_cost(len(json.dumps(body)) // 3, max_tokens)
    if spent_today() + worst > st.ai_daily_budget_usd:
        raise AIUnavailable(f"Daily AI budget of USD {st.ai_daily_budget_usd:.2f} reached.")
    raw = _post(body, st.anthropic_api_key, st.ai_timeout_s)
    if raw.get("type") == "error" or not isinstance(raw.get("content"), list):
        raise AIUnavailable(f"Unusable model response: {str(raw)[:200]}")
    usage = raw.get("usage") or {}
    cost = estimate_cost(int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0)))
    _record_spend(cost)
    out = {"content": raw["content"], "stop_reason": raw.get("stop_reason"), "usage": usage,
           "model": raw.get("model", st.ai_model)}
    if st.ai_fixture_replay:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return {**out, "cached": False, "cost_usd": round(cost, 6)}
