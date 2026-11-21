"""Local OCR for scanned invoices (PNG, JPEG and image-only PDFs).

Engine: RapidOCR (PP-OCR detection + recognition models executed locally with ONNX Runtime;
the model files ship inside the `rapidocr-onnxruntime` wheel). No network call, no paid API.

What this module guarantees:
* Every token keeps its recognition confidence and page/box coordinates (provenance).
* Tokens are grouped into visual rows and emitted cell by cell, so the same deterministic
  parser used for PDF text layers reads the result. Nothing is "corrected" except:
  - whitespace the recognizer dropped is restored **only** when the de-spaced run splits
    exactly into words already present in the dataset vocabulary (characters never change);
  - a leading OCR 'S' in front of a money amount is read as '$' (currency symbol only).
  Both normalizations are recorded next to the raw reading.
* Confidence below ``ocr_min_confidence`` makes the dependent field UNKNOWN (left blank and
  listed in ``uncertain_fields``) — the downstream EXTRACTION_INCOMPLETE hard hold applies.
* Oversized images/PDFs are refused before decoding (decompression-bomb guard).

If the engine is not installed or fails, ``run`` returns status ``UNAVAILABLE`` and the caller
falls back to a labelled demo fixture or manual entry. OCR output is labelled ``ocr``."""
from __future__ import annotations

import csv
import logging
import math
import re
import statistics
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings

log = logging.getLogger("brim.ocr")

ENGINE_NAME = "rapidocr_onnxruntime"
MAX_PIXELS = 40_000_000  # per page/image
MAX_PDF_PAGES = 5
PDF_DPI = 200
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg"}


@dataclass
class Token:
    text: str
    confidence: float
    page: int
    box: tuple[float, float, float, float]  # x0, y0, x1, y1
    angle: float = 0.0  # degrees of the detected box's top edge (page skew)

    @property
    def yc(self) -> float:
        return (self.box[1] + self.box[3]) / 2

    @property
    def height(self) -> float:
        return self.box[3] - self.box[1]


@dataclass
class OcrResult:
    status: str  # OK | EMPTY | UNAVAILABLE | REJECTED
    engine: str = ENGINE_NAME
    engine_version: str | None = None
    lines: list[str] = field(default_factory=list)
    confidences: list[float] = field(default_factory=list)
    raw_lines: list[str] = field(default_factory=list)
    normalizations: list[dict[str, str]] = field(default_factory=list)
    tokens: list[Token] = field(default_factory=list)
    pages: int = 0
    message: str | None = None

    @property
    def mean_confidence(self) -> float | None:
        return round(statistics.fmean(self.confidences), 4) if self.confidences else None

    def confidence_map(self) -> dict[str, float]:
        """Line text → lowest confidence seen for that exact text (conservative)."""
        out: dict[str, float] = {}
        for t, c in zip(self.lines, self.confidences):
            out[t] = min(c, out.get(t, 1.0))
        return out

    def provenance(self) -> dict[str, Any]:
        low = get_settings().ocr_min_confidence
        return {"engine": self.engine, "engine_version": self.engine_version, "pages": self.pages,
                "tokens": len(self.tokens), "mean_confidence": self.mean_confidence,
                "min_confidence_threshold": low,
                "low_confidence_tokens": [{"text": t.text, "confidence": round(t.confidence, 3), "page": t.page,
                                           "box": [round(v) for v in t.box]}
                                          for t in self.tokens if t.confidence < low][:50],
                "normalizations": self.normalizations[:100]}


# ----------------------------------------------------------------------------- engine
_engine_lock = threading.Lock()
_engine: Any = None
_engine_error: str | None = None


def _get_engine() -> Any:
    global _engine, _engine_error
    with _engine_lock:
        if _engine is None and _engine_error is None:
            try:
                from rapidocr_onnxruntime import RapidOCR

                # Low detection/recognition thresholds on purpose: weak tokens are KEPT with
                # their confidence so the parser can mark fields UNKNOWN instead of silently
                # dropping them.
                _engine = RapidOCR(det_box_thresh=0.3, text_score=0.3)
            except Exception as e:  # noqa: BLE001
                _engine_error = f"{type(e).__name__}: {e}"
                log.warning("OCR engine unavailable: %s", _engine_error)
        return _engine


def available() -> bool:
    return get_settings().ocr_enabled and _get_engine() is not None


def _engine_version() -> str | None:
    try:
        import importlib.metadata as md

        return md.version("rapidocr-onnxruntime")
    except Exception:  # noqa: BLE001
        return None


# ----------------------------------------------------------------------------- images
def _load_images(path: Path) -> list[Any]:
    """Return BGR numpy arrays (one per page). Raises ValueError for refused inputs."""
    import numpy as np

    suffix = path.suffix.lower()
    if suffix in IMAGE_SUFFIXES:
        from PIL import Image

        with Image.open(path) as im:  # reads the header only
            w, h = im.size
            if w * h > MAX_PIXELS:
                raise ValueError(f"image too large for OCR ({w}x{h} px)")
            rgb = im.convert("RGB")
            arr = np.asarray(rgb)
        return [arr[:, :, ::-1].copy()]
    if suffix == ".pdf":
        import pymupdf

        out = []
        with pymupdf.open(path) as doc:
            if doc.page_count > MAX_PDF_PAGES:
                raise ValueError(f"PDF has {doc.page_count} pages; OCR limit is {MAX_PDF_PAGES}")
            for page in doc:
                scale = PDF_DPI / 72
                if page.rect.width * scale * page.rect.height * scale > MAX_PIXELS:
                    raise ValueError("PDF page too large for OCR")
                pix = page.get_pixmap(dpi=PDF_DPI, alpha=False)
                arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
                out.append(arr[:, :, :3][:, :, ::-1].copy())
        return out
    raise ValueError(f"unsupported file type for OCR: {suffix}")


def _skew(tokens: list[Token]) -> float:
    """Median top-edge angle of wide boxes (degrees); scans are often rotated by ~1–3°."""
    angles = [t.angle for t in tokens if t.box[2] - t.box[0] > 60]
    return statistics.median(angles) if angles else 0.0


def _rows(tokens: list[Token]) -> list[list[Token]]:
    """Group tokens into visual rows by de-skewed vertical centre, then order each row left→right."""
    if not tokens:
        return []
    med_h = statistics.median(t.height for t in tokens) or 1.0
    tol = 0.5 * med_h
    rows: list[list[Token]] = []
    for page in sorted({t.page for t in tokens}):
        page_tokens = [t for t in tokens if t.page == page]
        slope = math.tan(math.radians(_skew(page_tokens)))

        def y(t: Token) -> float:
            return t.yc - slope * (t.box[0] + t.box[2]) / 2

        page_rows: list[list[Token]] = []
        for t in sorted(page_tokens, key=lambda t: (y(t), t.box[0])):
            if page_rows and abs(y(t) - statistics.fmean(y(x) for x in page_rows[-1])) <= tol:
                page_rows[-1].append(t)
            else:
                page_rows.append([t])
        rows.extend(page_rows)
    return [sorted(r, key=lambda t: t.box[0]) for r in rows]


# ----------------------------------------------------------------------------- normalization
_MONEY_S = re.compile(r"^-?S(?=\s?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})$)")
_SPLIT = re.compile(r"([A-Za-zÀ-ÿ]+)")


@lru_cache(maxsize=1)
def vocabulary() -> frozenset[str]:
    """Lower-cased words from the dataset (historical line descriptions, vendor names, GL names)
    plus invoice field labels. Used only to re-insert dropped spaces."""
    words: set[str] = {"invoice", "tax", "date", "due", "payment", "terms", "bill", "to", "remit", "subtotal",
                       "total", "description", "unit", "price", "amount", "qty", "thank", "you", "for", "your",
                       "business", "credit", "note", "number", "net", "po", "ref", "inst", "transit", "acct",
                       "facture", "montant", "sous", "conditions", "virement", "bancaire", "eft", "harborline",
                       "logistics", "inc", "ltd", "suite", "bureau", "st", "ave", "rue", "of", "and", "the"}
    data = get_settings().data_dir / "data"
    for name, cols in (("invoice_lines.csv", ("description",)), ("vendors.csv", ("legal_name", "address")),
                       ("gl_accounts.csv", ("name",))):
        p = data / name
        if not p.exists():
            continue
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                for c in cols:
                    words.update(w.lower() for w in _SPLIT.findall(r.get(c) or "") if len(w) >= 2)
    return frozenset(words)


def _segment(run: str, vocab: frozenset[str]) -> str | None:
    """Split an alphabetic run into the fewest vocabulary words; None if impossible."""
    low = run.lower()
    n = len(low)
    best: list[tuple[int, int] | None] = [None] * (n + 1)  # (word_count, prev_index)
    best[0] = (0, -1)
    for i in range(1, n + 1):
        for j in range(max(0, i - 24), i):
            if best[j] is not None and low[j:i] in vocab:
                cand = (best[j][0] + 1, j)
                if best[i] is None or cand[0] < best[i][0]:
                    best[i] = cand
    if best[n] is None:
        return None
    cuts, i = [], n
    while i > 0:
        j = best[i][1]
        cuts.append(run[j:i])
        i = j
    return " ".join(reversed(cuts))


def restore_spaces(text: str, vocab: frozenset[str] | None = None) -> str:
    vocab = vocab if vocab is not None else vocabulary()
    parts = _SPLIT.split(text)
    out = []
    for p in parts:
        if p and p[0].isalpha() and len(p) >= 6 and p.lower() not in vocab:
            seg = _segment(p, vocab)
            out.append(seg if seg else p)
        else:
            out.append(p)
    s = "".join(out)
    s = re.sub(r"(?<=[A-Za-zÀ-ÿ])\((?=[\d.,]+\s*%\))", " (", s)  # "surcharge(7%)" → "surcharge (7%)"
    return s


def normalize_line(raw: str, vocab: frozenset[str] | None = None) -> str:
    s = raw.strip()
    s = _MONEY_S.sub(lambda m: m.group(0).replace("S", "$"), s)
    if re.search(r"[A-Za-z]{6,}", s):
        s = restore_spaces(s, vocab)
    return s


# ----------------------------------------------------------------------------- entry point
def run(path: Path) -> OcrResult:
    settings = get_settings()
    if not settings.ocr_enabled:
        return OcrResult(status="UNAVAILABLE", message="OCR disabled (OCR_ENABLED=false)")
    engine = _get_engine()
    if engine is None:
        return OcrResult(status="UNAVAILABLE", message=_engine_error or "OCR engine not installed")
    try:
        images = _load_images(path)
    except ValueError as e:
        return OcrResult(status="REJECTED", message=str(e))
    except Exception as e:  # noqa: BLE001 — corrupt image etc.
        return OcrResult(status="REJECTED", message=f"could not decode document: {type(e).__name__}")
    tokens: list[Token] = []
    try:
        for page_no, img in enumerate(images, start=1):
            res, _elapsed = engine(img)
            for box, text, conf in res or []:
                xs = [float(p[0]) for p in box]
                ys = [float(p[1]) for p in box]
                if text and text.strip():
                    (tx0, ty0), (tx1, ty1) = box[0], box[1]
                    tokens.append(Token(text=text.strip(), confidence=float(conf), page=page_no,
                                        box=(min(xs), min(ys), max(xs), max(ys)),
                                        angle=math.degrees(math.atan2(float(ty1) - float(ty0),
                                                                      float(tx1) - float(tx0)))))
    except Exception as e:  # noqa: BLE001
        log.exception("OCR failed")
        return OcrResult(status="UNAVAILABLE", message=f"OCR engine error: {type(e).__name__}")
    result = OcrResult(status="OK" if tokens else "EMPTY", engine_version=_engine_version(), tokens=tokens,
                       pages=len(images))
    vocab = vocabulary()
    for row in _rows(tokens):
        cells: list[tuple[str, float]] = []
        for t in row:
            text = t.text.replace("：", ":")  # full-width colon
            # "Label" ":" "value" boxes on one row form one "Label: value" cell
            # (confidence = the weakest of the parts).
            if text.startswith(":") and cells and not cells[-1][0].endswith(":"):
                prev, pc = cells.pop()
                cells.append((f"{prev}:{(' ' + text[1:].strip()) if text[1:].strip() else ''}",
                              min(pc, t.confidence)))
            elif cells and cells[-1][0].endswith(":"):
                prev, pc = cells.pop()
                cells.append((f"{prev} {text}", min(pc, t.confidence)))
            else:
                cells.append((text, t.confidence))
        for text, conf in cells:
            norm = normalize_line(text, vocab)
            result.raw_lines.append(text)
            result.lines.append(norm)
            result.confidences.append(conf)
            if norm != text:
                result.normalizations.append({"raw": text, "normalized": norm})
    return result
