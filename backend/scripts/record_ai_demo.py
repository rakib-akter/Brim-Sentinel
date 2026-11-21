"""Record the AI investigation for the demo cases so the demo can replay them offline.

    AI_ENABLED=true ANTHROPIC_API_KEY=sk-... python -m scripts.record_ai_demo

Run on a freshly seeded database (`python -m scripts.seed`). Each model response is saved under
fixtures/ai/; later runs with AI_ENABLED=true and AI_FIXTURE_REPLAY=true (no key needed) replay
them, so the demo works without network or credits. Investigations are read-only: no hold,
approval or payment is changed. Lookup audit events are written, as in normal use."""
from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import ResolutionCase, User
from app.db.session import session_scope
from app.integrations import ai_gateway
from app.services import investigation

DEMO_CASE_TYPES = ["BANK_CHANGE_UNVERIFIED", "CARD_PAID_DUPLICATE", "FUEL_SURCHARGE_CAP_EXCEEDED",
                   "CONTRACT_RATE_EXCEEDED", "UNKNOWN_VENDOR"]


def main() -> int:
    st = get_settings()
    if not st.ai_enabled:
        print("Set AI_ENABLED=true (and ANTHROPIC_API_KEY) to record.")
        return 1
    with session_scope() as s:
        clerk = s.get(User, "U004")
        cases = [c for t in DEMO_CASE_TYPES
                 for c in s.scalars(select(ResolutionCase).where(ResolutionCase.case_type == t)
                                    .order_by(ResolutionCase.id).limit(2))]
        for c in cases:
            out = investigation.investigate(s, clerk, c)
            print(f"{c.id} {c.case_type:28} source={out['source']:22} lookups={len(out['lookups'])} "
                  f"cost=${out['ai_cost_usd'] or 0:.4f}")
            if out["source"] != "model":
                print(f"   fallback: {out['rejected_reason']}")
            else:
                print(f"   {out['summary']}")
    print(f"\nSpent today: ${ai_gateway.spent_today():.4f} of ${st.ai_daily_budget_usd:.2f}. "
          f"Recordings in {st.ai_fixtures_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
