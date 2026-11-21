"""AuditService: append-only, hash-chained application events (tamper-evident, not immutable
without an external trust anchor). Written in the same transaction as the business mutation.
Denied attempts are written in a separate transaction by the API error handler."""
from __future__ import annotations

import csv
import hashlib
import io
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditEvent, User, utcnow

GENESIS = "0" * 64


def _canonical(ev: AuditEvent) -> str:
    return json.dumps(
        {
            "occurred_at": ev.occurred_at.isoformat(),
            "actor_id": ev.actor_id,
            "action": ev.action,
            "object_type": ev.object_type,
            "object_id": ev.object_id,
            "object_version": ev.object_version,
            "result": ev.result,
            "before": ev.before_state,
            "after": ev.after_state,
            "policy_ids": ev.policy_ids,
            "evidence": ev.evidence,
            "details": ev.details,
            "prev_hash": ev.prev_hash,
        },
        sort_keys=True,
        default=str,
    )


def record(
    session: Session,
    *,
    actor: User | None,
    action: str,
    object_type: str,
    object_id: str,
    object_version: int | None = None,
    invoice_id: str | None = None,
    result: str = "SUCCESS",
    before: str | None = None,
    after: str | None = None,
    policy_ids: list[str] | None = None,
    evidence: list[Any] | None = None,
    details: dict[str, Any] | None = None,
    correlation_id: str | None = None,
    actor_id: str | None = None,
) -> AuditEvent:
    last = session.execute(select(AuditEvent.hash).order_by(AuditEvent.id.desc()).limit(1)).scalar()
    ev = AuditEvent(
        occurred_at=utcnow(),
        actor_id=actor.id if actor else actor_id,
        actor_kind=(actor.kind if actor else ("system" if actor_id is None else "human")),
        action=action,
        object_type=object_type,
        object_id=object_id,
        object_version=object_version,
        invoice_id=invoice_id if invoice_id is not None else (object_id if object_type == "invoice" else None),
        result=result,
        before_state=before,
        after_state=after,
        policy_ids=policy_ids or [],
        evidence=evidence or [],
        details=details or {},
        correlation_id=correlation_id,
        prev_hash=last or GENESIS,
        hash="",
    )
    ev.hash = hashlib.sha256(_canonical(ev).encode()).hexdigest()
    session.add(ev)
    session.flush()
    return ev


def verify_chain(session: Session) -> dict[str, Any]:
    prev = GENESIS
    count = 0
    for ev in session.scalars(select(AuditEvent).order_by(AuditEvent.id)):
        if ev.prev_hash != prev or hashlib.sha256(_canonical(ev).encode()).hexdigest() != ev.hash:
            return {"valid": False, "broken_at_event_id": ev.id, "events_checked": count}
        prev = ev.hash
        count += 1
    return {"valid": True, "events_checked": count, "head_hash": prev}


EXPORT_COLUMNS = [
    "id", "occurred_at", "actor_id", "actor_kind", "action", "object_type", "object_id",
    "object_version", "invoice_id", "result", "before_state", "after_state", "policy_ids",
    "evidence", "details", "prev_hash", "hash",
]


def to_csv(events: list[AuditEvent]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(EXPORT_COLUMNS)
    for e in events:
        w.writerow([
            e.id, e.occurred_at.isoformat(), e.actor_id, e.actor_kind, e.action, e.object_type, e.object_id,
            e.object_version, e.invoice_id, e.result, e.before_state, e.after_state,
            json.dumps(e.policy_ids), json.dumps(e.evidence, default=str), json.dumps(e.details, default=str),
            e.prev_hash, e.hash,
        ])
    return buf.getvalue()
