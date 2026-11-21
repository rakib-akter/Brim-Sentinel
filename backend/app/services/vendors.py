"""Vendor identity resolution and alias detection (RapidFuzz used for candidate generation only)."""
from __future__ import annotations

import re
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Vendor

_SUFFIXES = r"\b(ltd|limited|inc|incorporated|llp|llc|co|corp|corporation|company|s\.?e\.?n\.?c\.?r\.?l|ltee|ltée)\b"


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    s = name.lower().replace("&", " and ")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(_SUFFIXES, " ", s)
    return re.sub(r"\s+", " ", s).strip()


def match_vendor(session: Session, name: str | None, tax_id: str | None) -> dict[str, Any]:
    vendors = list(session.scalars(select(Vendor)))
    if name:
        exact = [v for v in vendors if v.legal_name.strip().lower() == name.strip().lower()]
        if len(exact) == 1:
            v = exact[0]
            return {"vendor_id": v.id, "method": "exact_legal_name", "score": 100,
                    "tax_id_match": (v.gst_hst_number == tax_id) if tax_id and v.gst_hst_number else None}
    if tax_id:
        by_tax = [v for v in vendors if v.gst_hst_number and v.gst_hst_number == tax_id]
        if len(by_tax) == 1:
            return {"vendor_id": by_tax[0].id, "method": "gst_hst_number", "score": 100, "tax_id_match": True}
    candidates = []
    nn = normalize_name(name)
    for v in vendors:
        sc = fuzz.token_sort_ratio(nn, normalize_name(v.legal_name))
        if sc >= 80:
            candidates.append({"vendor_id": v.id, "legal_name": v.legal_name, "score": round(sc)})
    candidates.sort(key=lambda c: -c["score"])
    # A fuzzy name alone never auto-resolves a vendor: ambiguity is held for onboarding/review.
    return {"vendor_id": None, "method": "unmatched", "score": 0, "candidates": candidates[:3], "tax_id_match": None}


def similar_identities(session: Session, vendor: Vendor, threshold: int = 88) -> list[dict[str, Any]]:
    out = []
    nn = normalize_name(vendor.legal_name)
    for other in session.scalars(select(Vendor).where(Vendor.id != vendor.id)):
        sc = fuzz.token_sort_ratio(nn, normalize_name(other.legal_name))
        if sc >= threshold:
            out.append({"vendor_id": other.id, "legal_name": other.legal_name, "score": round(sc),
                        "status": other.status,
                        "same_bank_account": bool(vendor.bank_account and vendor.bank_account == other.bank_account),
                        "category": other.category})
    return out


def mask(last4: str | None) -> str | None:
    return f"****{last4}" if last4 else None
