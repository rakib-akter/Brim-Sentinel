"""CodingService (FR-03): GL + department suggestion per line.

GL: the supervised TF-IDF + logistic-regression model in `app/ml/coding_model.py` (temporal-
holdout metrics in `docs/eval/coding_model_metrics.json`). Confidence is the model's top-class
probability. Suppliers the model never saw use the text-only variant and are capped below the
review threshold (always human-reviewed). Three supporting historical lines come from the
RapidFuzz nearest-neighbour search, which is also the complete fallback when the model cannot be
loaded (`knn_rapidfuzz_v1`). Department: PO → vendor history → unknown (never guessed).
Confidence < 0.70 requires human review; the suggestion never approves anything."""
from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal
from typing import Any

from rapidfuzz import fuzz, process
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GLAccount, Invoice, InvoiceLine, InvoiceVersion, Vendor
from app.ml import coding_model

METHOD = "knn_rapidfuzz_v1"  # fallback / supporting-example method
MODEL_METHOD = coding_model.MODEL_VERSION
UNSEEN_VENDOR_CAP = Decimal("0.69")
REVIEW_THRESHOLD = Decimal("0.70")
K = 5


def _history(session: Session) -> list[dict[str, Any]]:
    rows = session.execute(
        select(InvoiceLine.invoice_id, InvoiceLine.line_no, InvoiceLine.description, InvoiceLine.gl_account,
               InvoiceLine.department_id, InvoiceLine.line_type, Invoice.vendor_id)
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .where(Invoice.source_kind == "historical_ledger", InvoiceLine.gl_account.is_not(None))
    ).all()
    return [dict(r._mapping) for r in rows]


def suggest_line(history: list[dict[str, Any]], vendor_id: str | None, description: str,
                 vendor_default_gl: str | None, gl_names: dict[str, str]) -> dict[str, Any]:
    pool = [h for h in history if vendor_id and h["vendor_id"] == vendor_id]
    scope = "same_vendor"
    if len(pool) < 3:
        pool, scope = history, "all_vendors"
    if not pool:
        return {"gl_account": vendor_default_gl, "confidence": "0.00", "method": METHOD, "scope": "none",
                "alternatives": [], "similar_lines": []}
    choices = [h["description"] for h in pool]
    hits = process.extract(description, choices, scorer=fuzz.token_set_ratio, limit=K)
    votes: dict[str, float] = defaultdict(float)
    for _choice, score, idx in hits:
        votes[pool[idx]["gl_account"]] += score / 100.0
    total = sum(votes.values()) or 1.0
    ranked = sorted(votes.items(), key=lambda kv: -kv[1])
    best_gl, best_v = ranked[0]
    top_sim = hits[0][1] / 100.0 if hits else 0.0
    # Confidence = similarity-weighted vote share × novelty factor. A line unlike anything the
    # supplier billed before (top similarity < 0.60) is scaled down so a person reviews it.
    novelty = 1.0 if top_sim >= 0.60 else top_sim / 0.60
    conf = Decimal(str(round((best_v / total) * novelty, 2)))
    if scope == "all_vendors":
        conf = min(conf, Decimal("0.69"))  # unseen supplier: always human-reviewed
    similar = [{"invoice_id": pool[idx]["invoice_id"], "line_no": pool[idx]["line_no"],
                "description": pool[idx]["description"], "gl_account": pool[idx]["gl_account"],
                "similarity": round(score)} for _c, score, idx in hits[:3]]
    return {
        "gl_account": best_gl, "gl_name": gl_names.get(best_gl), "confidence": str(conf), "method": METHOD,
        "scope": scope,
        "alternatives": [{"gl_account": g, "gl_name": gl_names.get(g), "weight": round(v / total, 2)}
                         for g, v in ranked[1:3]],
        "similar_lines": similar,
        "vendor_default_gl": vendor_default_gl,
    }


def _dec(p: float) -> Decimal:
    return Decimal(str(round(p, 2)))


def suggest_line_model(history: list[dict[str, Any]], vendor: Vendor | None, description: str,
                       province: str | None, gl_names: dict[str, str]) -> dict[str, Any]:
    """Model suggestion with kNN supporting examples; falls back to `suggest_line` (RapidFuzz)."""
    vendor_id = vendor.id if vendor else None
    default_gl = vendor.default_gl_account if vendor else None
    knn = suggest_line(history, vendor_id, description, default_gl, gl_names)
    model = coding_model.load_model()
    if model is None:
        return {**knn, "fallback_reason": "coding model unavailable"}
    pred = model.predict(description=description, vendor_id=vendor_id, category=vendor.category if vendor else None,
                         default_gl=default_gl, province=province)
    (best_gl, best_p), *rest = pred["ranked"]
    conf = _dec(best_p)
    if not pred["seen_vendor"]:
        conf = min(conf, UNSEEN_VENDOR_CAP)  # unseen supplier: always human-reviewed
    return {
        "gl_account": best_gl, "gl_name": gl_names.get(best_gl), "confidence": str(conf), "method": MODEL_METHOD,
        "model_variant": pred["variant"], "model_source": model.source, "model_probability": round(best_p, 4),
        "scope": "same_vendor" if pred["seen_vendor"] else "unseen_vendor",
        "alternatives": [{"gl_account": g, "gl_name": gl_names.get(g), "weight": round(p, 2)} for g, p in rest],
        "similar_lines": knn["similar_lines"],
        "knn_gl_account": knn["gl_account"], "knn_agrees": knn["gl_account"] == best_gl,
        "vendor_default_gl": default_gl,
    }


def infer_line_type(history: list[dict[str, Any]], vendor_id: str | None) -> str | None:
    types = Counter(h["line_type"] for h in history if vendor_id and h["vendor_id"] == vendor_id and h["line_type"])
    return types.most_common(1)[0][0] if types else None


def code_version(session: Session, version: InvoiceVersion) -> list[InvoiceLine]:
    history = _history(session)
    gl_names = {g.account_number: g.name for g in session.scalars(select(GLAccount))}
    vendor = session.get(Vendor, version.vendor_id) if version.vendor_id else None
    line_type = infer_line_type(history, version.vendor_id)
    lines = list(session.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id == version.invoice_id,
                                                         InvoiceLine.version == version.version)
                                 .order_by(InvoiceLine.line_no)))
    for ln in lines:
        if ln.coding_status in {"CONFIRMED", "OVERRIDDEN"}:
            continue
        s = suggest_line_model(history, vendor, ln.description, version.ship_to_province, gl_names)
        ln.gl_account = s["gl_account"]
        ln.department_id = version.department_id
        ln.coding_confidence = s["confidence"]
        ln.coding_method = s["method"]
        ln.line_type = ln.line_type or line_type
        needs_review = Decimal(s["confidence"]) < REVIEW_THRESHOLD or version.department_id is None
        ln.coding_status = "NEEDS_REVIEW" if needs_review else "SUGGESTED"
        ln.coding_detail = {**s, "department_source": version.department_source}
    session.flush()
    return lines


def infer_department(session: Session, vendor_id: str | None, po_number: str | None) -> dict[str, Any]:
    from app.db.models import PurchaseOrder

    if po_number:
        po = session.get(PurchaseOrder, po_number)
        if po and po.department_id:
            return {"department_id": po.department_id, "requester_id": po.requester_user_id,
                    "source": f"purchase_order:{po.id}"}
    if vendor_id:
        rows = session.execute(
            select(InvoiceVersion.department_id, InvoiceVersion.requester_id, InvoiceVersion.invoice_date)
            .join(Invoice, Invoice.id == InvoiceVersion.invoice_id)
            .where(Invoice.source_kind == "historical_ledger", Invoice.vendor_id == vendor_id)
        ).all()
        if rows:
            dept = Counter(r.department_id for r in rows if r.department_id).most_common(1)[0][0]
            latest = max((r for r in rows if r.department_id == dept), key=lambda r: r.invoice_date or "")
            return {"department_id": dept, "requester_id": latest.requester_id,
                    "source": f"vendor_history:{len(rows)}_invoices"}
    return {"department_id": None, "requester_id": None, "source": "unknown"}
