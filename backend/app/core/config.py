"""Runtime configuration. Values come from environment variables only (no .env auto-loading
so that tests stay hermetic)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("BRIM_DATA_DIR", str(REPO_DIR / "data" / "brim_ap_dataset"))
        ).resolve()
    )
    database_url: str = field(
        default_factory=lambda: os.environ.get("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'brim.db'}")
    )
    demo_mode: bool = field(default_factory=lambda: _bool("DEMO_MODE", True))
    ai_enabled: bool = field(default_factory=lambda: _bool("AI_ENABLED", False))
    # Investigation agent (PRD §5A / v1.4 A3). Model and prices are configurable; prices are only
    # used for budget enforcement and cost logging — set them to your plan's actual rates.
    anthropic_api_key: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", ""), repr=False)
    ai_model: str = field(default_factory=lambda: os.environ.get("AI_MODEL", "claude-sonnet-5-5"))
    ai_fixture_replay: bool = field(default_factory=lambda: _bool("AI_FIXTURE_REPLAY", True))
    ai_max_calls_per_case: int = field(default_factory=lambda: int(os.environ.get("AI_MAX_CALLS_PER_CASE", "8")))
    ai_daily_budget_usd: float = field(default_factory=lambda: float(os.environ.get("AI_DAILY_BUDGET_USD", "5")))
    ai_case_budget_usd: float = field(default_factory=lambda: float(os.environ.get("AI_CASE_BUDGET_USD", "0.50")))
    ai_input_usd_per_mtok: float = field(default_factory=lambda: float(os.environ.get("AI_INPUT_USD_PER_MTOK", "3")))
    ai_output_usd_per_mtok: float = field(default_factory=lambda: float(os.environ.get("AI_OUTPUT_USD_PER_MTOK", "15")))
    ai_timeout_s: float = field(default_factory=lambda: float(os.environ.get("AI_TIMEOUT_S", "30")))
    ai_fixtures_dir: Path = field(default_factory=lambda: Path(
        os.environ.get("AI_FIXTURES_DIR", str(BACKEND_DIR / "fixtures" / "ai"))).resolve())
    ai_usage_file: Path = field(default_factory=lambda: Path(
        os.environ.get("AI_USAGE_FILE", str(BACKEND_DIR / ".ai_usage.json"))).resolve())
    frontend_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.environ.get(
                "FRONTEND_ORIGIN", "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173"
            ).split(",")
            if o.strip()
        )
    )
    # Dataset as-of date (README: "As-of date: 2026-11-02"). Used for leave/termination status
    # and anomaly as-of evaluation so results are reproducible regardless of wall clock.
    as_of_date: str = field(default_factory=lambda: os.environ.get("BRIM_AS_OF_DATE", "2026-11-02"))
    upload_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("BRIM_UPLOAD_DIR", str(BACKEND_DIR / "uploads"))).resolve()
    )
    fixtures_dir: Path = BACKEND_DIR / "fixtures"
    max_upload_bytes: int = 10 * 1024 * 1024
    # Local OCR (RapidOCR/ONNX). Tokens below the confidence threshold leave the field UNKNOWN.
    ocr_enabled: bool = field(default_factory=lambda: _bool("OCR_ENABLED", True))
    ocr_min_confidence: float = field(default_factory=lambda: float(os.environ.get("OCR_MIN_CONFIDENCE", "0.80")))
    # Per-actor limit on mutating requests (POST/PATCH) per rolling minute; 0 disables.
    rate_limit_per_minute: int = field(default_factory=lambda: int(os.environ.get("RATE_LIMIT_PER_MINUTE", "120")))


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Testing hook: re-read environment."""
    global _settings
    _settings = None
