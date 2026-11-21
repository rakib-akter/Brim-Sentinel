"""Write the generated OpenAPI document to backend/openapi.json (`python -m scripts.export_openapi`)."""
from __future__ import annotations

import json

from app.core.config import BACKEND_DIR
from app.main import app


def main() -> None:
    out = BACKEND_DIR / "openapi.json"
    out.write_text(json.dumps(app.openapi(), indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
