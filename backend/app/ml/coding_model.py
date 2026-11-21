"""FR-03 GL coding model: supervised TF-IDF + logistic regression.

Two pipelines are trained on the historical ledger lines (`invoice_lines.csv` ⋈ `invoices.csv`
⋈ `vendors.csv`):

* ``full``      – TF-IDF (word 1–2 grams + char_wb 3–5 grams) on the line description plus
                  one-hot vendor_id / vendor category / vendor default GL / ship-to province.
* ``text_only`` – the same text features only; used for suppliers the model has never seen
                  (unknown or newly onboarded vendors), so a vendor one-hot cannot silently
                  dominate.

Evaluation (``evaluate``) uses a **temporal holdout**: fit on invoices dated on/before
``TRAIN_CUTOFF`` and score invoices dated after it. All vectorizers/encoders are fitted inside
the sklearn Pipeline on the training fold only, the split is by invoice date (every line of an
invoice lands on the same side) and rejected historical invoices are excluded from both folds.
The shipped artifact is refit on all eligible history *after* evaluation; the reported metrics
come from the holdout model only.

The artifact is a joblib file whose SHA-256 and scikit-learn version are recorded in a JSON
manifest. ``load_model`` refuses to unpickle a file whose hash does not match, and when the
artifact is missing or was produced by another scikit-learn version it retrains in memory with
the identical deterministic procedure. If scikit-learn itself is unavailable the caller falls
back to the RapidFuzz nearest-neighbour suggester.

CLI::

    python -m app.ml.coding_model evaluate   # temporal holdout metrics (JSON)
    python -m app.ml.coding_model train      # evaluate + refit + write artifact & manifest
    python -m app.ml.coding_model suggest V004 "LTL shipment Calgary-Regina"
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import logging
import sys
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import BACKEND_DIR, get_settings

log = logging.getLogger("brim.coding_model")

MODEL_VERSION = "tfidf_logreg_v1"
TRAIN_CUTOFF = "2026-08-31"  # train ≤ cutoff, test = Sep–Oct 2026
REVIEW_THRESHOLD = 0.70
RANDOM_STATE = 0
ARTIFACT_DIR = BACKEND_DIR / "models"
ARTIFACT_PATH = ARTIFACT_DIR / "coding_model.joblib"
MANIFEST_PATH = ARTIFACT_DIR / "coding_model.json"
METRICS_PATH = BACKEND_DIR / "docs" / "eval" / "coding_model_metrics.json"
CAT_COLS = ("vendor_id", "category", "default_gl", "province")
EXCLUDED_STATUSES = {"rejected"}


# ----------------------------------------------------------------------------- data
def _csv(data_dir: Path, name: str) -> list[dict[str, str]]:
    with open(data_dir / "data" / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rows(data_dir: Path | None = None) -> list[dict[str, str]]:
    """One row per historical invoice line with its invoice date and vendor attributes.
    Rejected invoices and lines without a GL account are excluded."""
    data_dir = data_dir or get_settings().data_dir
    invoices = {r["invoice_id"]: r for r in _csv(data_dir, "invoices.csv")}
    vendors = {r["vendor_id"]: r for r in _csv(data_dir, "vendors.csv")}
    rows = []
    for ln in _csv(data_dir, "invoice_lines.csv"):
        inv = invoices.get(ln["invoice_id"])
        if inv is None or inv["status"] in EXCLUDED_STATUSES or not ln["gl_account"]:
            continue
        ven = vendors.get(inv["vendor_id"], {})
        rows.append({
            "invoice_id": ln["invoice_id"], "line_no": ln["line_no"], "invoice_date": inv["invoice_date"],
            "description": ln["description"], "gl_account": ln["gl_account"], "vendor_id": inv["vendor_id"],
            "category": ven.get("category", ""), "default_gl": ven.get("default_gl_account", ""),
            "province": inv.get("ship_to_province", ""),
        })
    rows.sort(key=lambda r: (r["invoice_date"], r["invoice_id"], int(r["line_no"])))
    return rows


def temporal_split(rows: list[dict[str, str]], cutoff: str = TRAIN_CUTOFF) -> tuple[list[dict], list[dict]]:
    train = [r for r in rows if r["invoice_date"] <= cutoff]
    test = [r for r in rows if r["invoice_date"] > cutoff]
    return train, test


def _matrix(rows: list[dict[str, str]]):  # noqa: ANN202
    import numpy as np

    return np.array([[r.get("description") or "", *[(r.get(c) or "") for c in CAT_COLS]] for r in rows],
                    dtype=object)


# ----------------------------------------------------------------------------- model
def build_pipeline(with_vendor_features: bool):  # noqa: ANN201
    from sklearn.compose import ColumnTransformer
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    transformers: list[tuple[str, Any, Any]] = [
        ("word", TfidfVectorizer(ngram_range=(1, 2), lowercase=True, sublinear_tf=True), 0),
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), lowercase=True, sublinear_tf=True), 0),
    ]
    if with_vendor_features:
        transformers.append(("cat", OneHotEncoder(handle_unknown="ignore"), [1, 2, 3, 4]))
    return Pipeline([
        ("features", ColumnTransformer(transformers)),
        ("clf", LogisticRegression(C=10.0, max_iter=5000, random_state=RANDOM_STATE)),
    ])


@dataclass
class CodingModel:
    full: Any
    text_only: Any
    known_vendors: set[str]
    trained_rows: int
    trained_through: str
    source: str  # artifact | trained_in_memory
    manifest: dict[str, Any] = field(default_factory=dict)

    def predict(self, *, description: str, vendor_id: str | None, category: str | None, default_gl: str | None,
                province: str | None, top_k: int = 3) -> dict[str, Any]:
        seen = bool(vendor_id) and vendor_id in self.known_vendors
        pipe = self.full if seen else self.text_only
        x = _matrix([{"description": description, "vendor_id": vendor_id or "", "category": category or "",
                      "default_gl": default_gl or "", "province": province or ""}])
        proba = pipe.predict_proba(x)[0]
        classes = list(pipe.classes_)
        ranked = sorted(zip(classes, proba), key=lambda kv: (-kv[1], kv[0]))[:top_k]
        return {"variant": "full" if seen else "text_only", "seen_vendor": seen,
                "ranked": [(str(c), float(p)) for c, p in ranked]}


def fit(rows: list[dict[str, str]], source: str = "trained_in_memory") -> CodingModel:
    x = _matrix(rows)
    y = [r["gl_account"] for r in rows]
    full = build_pipeline(True).fit(x, y)
    text_only = build_pipeline(False).fit(x, y)
    return CodingModel(full=full, text_only=text_only, known_vendors={r["vendor_id"] for r in rows},
                       trained_rows=len(rows), trained_through=max(r["invoice_date"] for r in rows), source=source)


# ----------------------------------------------------------------------------- evaluation
def _knn_baseline(train: list[dict], row: dict) -> str | None:
    """The pre-existing RapidFuzz suggester, evaluated on the same split for comparison."""
    from rapidfuzz import fuzz, process

    pool = [h for h in train if h["vendor_id"] == row["vendor_id"]]
    if len(pool) < 3:
        pool = train
    hits = process.extract(row["description"], [h["description"] for h in pool], scorer=fuzz.token_set_ratio,
                           limit=5)
    votes: dict[str, float] = defaultdict(float)
    for _c, score, idx in hits:
        votes[pool[idx]["gl_account"]] += score
    return max(sorted(votes), key=lambda g: votes[g]) if votes else None


def _acc(pairs: list[tuple[str | None, str]]) -> float | None:
    return round(sum(p == t for p, t in pairs) / len(pairs), 4) if pairs else None


def evaluate(rows: list[dict[str, str]] | None = None, cutoff: str = TRAIN_CUTOFF) -> dict[str, Any]:
    from sklearn.metrics import f1_score

    rows = rows if rows is not None else load_rows()
    train, test = temporal_split(rows, cutoff)
    if not train or not test:
        raise ValueError("Temporal split produced an empty fold.")
    # Leakage guards (fail loudly rather than report contaminated metrics).
    assert max(r["invoice_date"] for r in train) < min(r["invoice_date"] for r in test)
    assert not ({r["invoice_id"] for r in train} & {r["invoice_id"] for r in test})

    model = fit(train)
    train_vendors = {r["vendor_id"] for r in train}
    train_desc = {r["description"].strip().lower() for r in train}
    vendor_default = {r["vendor_id"]: r["default_gl"] for r in rows}
    vendor_mode: dict[str, str] = {}
    for vid in train_vendors:
        c = Counter(r["gl_account"] for r in train if r["vendor_id"] == vid)
        vendor_mode[vid] = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]

    preds, text_only_preds, confs = [], [], []
    for r in test:
        p = model.predict(description=r["description"], vendor_id=r["vendor_id"], category=r["category"],
                          default_gl=r["default_gl"], province=r["province"])
        preds.append(p["ranked"])
        confs.append(p["ranked"][0][1])
        cold = model.predict(description=r["description"], vendor_id=None, category=None, default_gl=None,
                             province=None)
        text_only_preds.append(cold["ranked"][0][0])
    y = [r["gl_account"] for r in test]
    top1 = [p[0][0] for p in preds]
    top3_hit = [t in {g for g, _ in p} for p, t in zip(preds, y)]
    gated = [(p, t) for p, t, c in zip(top1, y, confs) if c >= REVIEW_THRESHOLD]
    unseen_idx = [i for i, r in enumerate(test) if r["vendor_id"] not in train_vendors]
    novel_idx = [i for i, r in enumerate(test) if r["description"].strip().lower() not in train_desc]
    knn = [_knn_baseline(train, r) for r in test]
    labels = sorted(set(y))

    def subset(idx: list[int], pred: list[str | None]) -> dict[str, Any]:
        return {"n": len(idx), "accuracy": _acc([(pred[i], y[i]) for i in idx])}

    # Cold start: for every supplier in the test fold, refit the text-only model on the training
    # fold WITHOUT any of that supplier's lines and score its test lines (leave-one-vendor-out).
    lovo_pairs, lovo_conf = [], []
    knn_lovo = []
    for vid in sorted({r["vendor_id"] for r in test}):
        tr = [r for r in train if r["vendor_id"] != vid]
        te = [r for r in test if r["vendor_id"] == vid]
        pipe = build_pipeline(False).fit(_matrix(tr), [r["gl_account"] for r in tr])
        proba = pipe.predict_proba(_matrix(te))
        for r, pr in zip(te, proba):
            best = max(range(len(pr)), key=lambda i: (pr[i], -i))
            lovo_pairs.append((str(pipe.classes_[best]), r["gl_account"]))
            lovo_conf.append(float(pr[best]))
            knn_lovo.append((_knn_baseline(tr, {**r, "vendor_id": "__unseen__"}), r["gl_account"]))
    lovo_gated = [pt for pt, c in zip(lovo_pairs, lovo_conf) if c >= REVIEW_THRESHOLD]

    return {
        "model_version": MODEL_VERSION,
        "evaluated_at": dt.date.today().isoformat(),
        "split": {"type": "temporal_holdout", "train": f"invoice_date <= {cutoff}", "test": f"invoice_date > {cutoff}",
                  "train_lines": len(train), "test_lines": len(test),
                  "train_invoices": len({r["invoice_id"] for r in train}),
                  "test_invoices": len({r["invoice_id"] for r in test}),
                  "train_date_range": [train[0]["invoice_date"], train[-1]["invoice_date"]],
                  "test_date_range": [test[0]["invoice_date"], test[-1]["invoice_date"]],
                  "excluded": "rejected historical invoices; lines without a GL account",
                  "leakage_controls": ["split by invoice date (no invoice spans both folds)",
                                       "TF-IDF/one-hot fitted inside the pipeline on the training fold only",
                                       "no target-derived features; vendor default GL comes from vendor master"]},
        "classes_in_test": len(labels),
        "model": {
            "accuracy": _acc(list(zip(top1, y))),
            "top3_accuracy": round(sum(top3_hit) / len(top3_hit), 4),
            "macro_f1": round(float(f1_score(y, top1, labels=labels, average="macro", zero_division=0)), 4),
            "coverage_at_0_70": round(len(gated) / len(test), 4),
            "accuracy_at_0_70": _acc(gated),
            "lines_sent_to_review_at_0_70": len(test) - len(gated),
        },
        "text_only_model_all_test_lines": {"accuracy": _acc(list(zip(text_only_preds, y))),
                                           "note": "cold-start proxy: vendor features withheld for every line"},
        "baselines": {
            "vendor_default_gl": _acc([(vendor_default.get(r["vendor_id"]), r["gl_account"]) for r in test]),
            "vendor_most_frequent_gl_in_train": _acc([(vendor_mode.get(r["vendor_id"]), r["gl_account"])
                                                      for r in test]),
            "rapidfuzz_knn_previous_method": _acc(list(zip(knn, y))),
        },
        "cold_start_leave_one_vendor_out": {
            "n": len(lovo_pairs),
            "text_only_accuracy": _acc(lovo_pairs),
            "rapidfuzz_knn_accuracy": _acc(knn_lovo),
            "coverage_at_0_70": round(len(lovo_gated) / len(lovo_pairs), 4) if lovo_pairs else None,
            "accuracy_at_0_70": _acc(lovo_gated),
            "note": "Each test supplier's lines scored by a text-only model trained without that supplier. "
                    "In production unseen suppliers are always human-reviewed; this measures suggestion quality.",
        },
        "subsets": {
            "unseen_vendor_lines": subset(unseen_idx, top1),
            "novel_description_lines": subset(novel_idx, top1),
            "novel_description_lines_text_only": subset(novel_idx, text_only_preds),
        },
        "caveats": [
            "Synthetic dataset; GL codes are highly predictable from the vendor, so vendor baselines are strong.",
            "Recurring invoices repeat descriptions across months; see novel_description_lines for unseen text.",
            "Unseen suppliers are always routed to human review regardless of model confidence.",
        ],
    }


# ----------------------------------------------------------------------------- persistence
def _data_fingerprint(data_dir: Path) -> dict[str, str]:
    return {n: file_sha256(data_dir / "data" / n) for n in ("invoice_lines.csv", "invoices.csv", "vendors.csv")}


def train_and_save(data_dir: Path | None = None) -> dict[str, Any]:
    import joblib
    import sklearn

    data_dir = data_dir or get_settings().data_dir
    rows = load_rows(data_dir)
    metrics = evaluate(rows)
    model = fit(rows, source="artifact")
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"full": model.full, "text_only": model.text_only, "known_vendors": sorted(model.known_vendors),
                 "trained_rows": model.trained_rows, "trained_through": model.trained_through}, ARTIFACT_PATH,
                compress=3)
    manifest = {
        "model_version": MODEL_VERSION, "artifact": ARTIFACT_PATH.name, "sha256": file_sha256(ARTIFACT_PATH),
        "sklearn_version": sklearn.__version__, "trained_rows": model.trained_rows,
        "trained_through": model.trained_through, "training_data_sha256": _data_fingerprint(data_dir),
        "review_threshold": REVIEW_THRESHOLD, "holdout_metrics_file": "docs/eval/coding_model_metrics.json",
        "note": "Shipped model is refit on all eligible history; quoted metrics are from the temporal holdout.",
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    METRICS_PATH.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    return {"manifest": manifest, "metrics": metrics}


_lock = threading.Lock()
_cached: CodingModel | None = None
_load_attempted = False


def load_model() -> CodingModel | None:
    """Verified artifact → deterministic in-memory retrain → None (caller uses RapidFuzz)."""
    global _cached, _load_attempted
    with _lock:
        if _load_attempted:
            return _cached
        _load_attempted = True
        try:
            import sklearn
        except ImportError:
            log.warning("scikit-learn not installed; GL coding falls back to RapidFuzz kNN")
            return None
        try:
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.exists() else None
            if (manifest and ARTIFACT_PATH.exists() and manifest.get("sklearn_version") == sklearn.__version__
                    and manifest.get("sha256") == file_sha256(ARTIFACT_PATH)):
                import joblib

                blob = joblib.load(ARTIFACT_PATH)  # hash verified above: only our own artifact is unpickled
                _cached = CodingModel(full=blob["full"], text_only=blob["text_only"],
                                      known_vendors=set(blob["known_vendors"]), trained_rows=blob["trained_rows"],
                                      trained_through=blob["trained_through"], source="artifact", manifest=manifest)
            else:
                if manifest is not None:
                    log.warning("coding model artifact rejected (hash or sklearn version mismatch); retraining")
                rows = load_rows()
                _cached = fit(rows)
        except Exception:  # noqa: BLE001 — never let the suggester break intake
            log.exception("coding model unavailable; falling back to RapidFuzz kNN")
            _cached = None
        return _cached


def reset_cache() -> None:
    global _cached, _load_attempted
    with _lock:
        _cached, _load_attempted = None, False


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "evaluate"
    if cmd == "evaluate":
        print(json.dumps(evaluate(), indent=2))
    elif cmd == "train":
        out = train_and_save()
        print(json.dumps(out["metrics"], indent=2))
        print(f"artifact: {ARTIFACT_PATH} sha256={out['manifest']['sha256']}")
    elif cmd == "suggest" and len(argv) >= 4:
        m = load_model()
        if m is None:
            print("model unavailable", file=sys.stderr)
            return 1
        print(json.dumps(m.predict(description=argv[3], vendor_id=argv[2], category=None, default_gl=None,
                                   province=None), indent=2))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
