"""The ONLY module allowed to call a model. AI is OFF by default (AI_ENABLED=false) and this build
ships no provider client, so `complete()` always reports unavailable and callers fall back to the
deterministic template. Nothing here can mutate state: it receives already-fetched, masked tool
results and returns untrusted text that is schema- and fact-checked by InvestigationService."""
from __future__ import annotations

from typing import Any

from app.core.config import get_settings


class AIUnavailable(Exception):
    pass


def complete(prompt_version: str, payload: dict[str, Any]) -> dict[str, Any]:  # noqa: ARG001
    if not get_settings().ai_enabled:
        raise AIUnavailable("AI_ENABLED=false (default). Deterministic investigation used.")
    # A provider integration would go here, with budget caps and fixture replay. It is intentionally
    # not implemented in this build so that no paid API is ever contacted.
    raise AIUnavailable("No AI provider configured in this build.")
