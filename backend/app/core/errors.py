"""Domain errors mapped to the canonical error envelope
{"error": {"code", "message", "details", "correlation_id"}}."""
from __future__ import annotations

from typing import Any


class DomainError(Exception):
    status_code = 400

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None, *, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        if status_code is not None:
            self.status_code = status_code


class Unauthenticated(DomainError):
    status_code = 401


class Forbidden(DomainError):
    """Role/scope/segregation-of-duties denial. Always audited as DENIED."""
    status_code = 403


class NotFound(DomainError):
    status_code = 404


class Conflict(DomainError):
    """Version conflict, idempotency payload mismatch, invalid transition."""
    status_code = 409


class Unprocessable(DomainError):
    """Unmet business prerequisite (e.g. hold not resolved)."""
    status_code = 422
