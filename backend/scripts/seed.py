"""Idempotent seed: `python -m scripts.seed` (from backend/)."""
from __future__ import annotations

import json
import time

from app.db.session import init_db, session_scope
from app.db.seed import run_seed


def main() -> None:
    t = time.time()
    init_db()
    with session_scope() as s:
        counts = run_seed(s)
    print(json.dumps({"counts": counts, "seconds": round(time.time() - t, 1)}, indent=2))


if __name__ == "__main__":
    main()
