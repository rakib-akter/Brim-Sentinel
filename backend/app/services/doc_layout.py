"""Where each extracted value sits on the original document.

Powers the source-grounded review: the UI shows the page and draws a box around the exact
place every key value (invoice number, dates, totals, line items, bank details) was read.

* Text PDFs: word boxes from the PDF text layer (PyMuPDF), in PDF points.
* Scans and images: OCR token boxes (RapidOCR), in pixels of the image OCR read.

Locating is a pure function (`locate`) over tokens, so it is tested without any PDF library.
Nothing here changes an extracted value: if a value cannot be found on the page it simply has
no box, and the UI says so."""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from statistics import median
from typing import Any, Iterable

from app.services.extraction import FIELD_LABELS, SUBTOTAL_LABELS

RENDER_SCALE = 2.0  # PDF pages are rendered at 144 dpi for the viewer


@dataclass(frozen=True)
class Tok:
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    confidence: float | None = None  # None for an exact PDF text layer

    @property
    def yc(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class Target:
    key: str
    candidates: list[str]  # alternative spellings of the value as it may appear on the page
    labels: tuple[str, ...] = ()  # label words that usually sit on the same row
    prefer: str = "first"  # first | last occurrence when no label decides
    row: str = ""  # "" just the value | "right" value to end of row (line items) | "all" whole row


# ----------------------------------------------------------------------------- tokens
def _compact(s: str) -> str:
    return re.sub(r"\s+", "", s).lower()


def rows(tokens: Iterable[Tok]) -> list[list[Tok]]:
    """Group tokens into visual rows (per page, by vertical centre), each sorted left to right."""
    out: list[list[Tok]] = []
    by_page: dict[int, list[Tok]] = {}
    for t in tokens:
        by_page.setdefault(t.page, []).append(t)
    for page in sorted(by_page):
        toks = sorted(by_page[page], key=lambda t: (t.yc, t.x0))
        tol = 0.5 * median([max(t.y1 - t.y0, 1.0) for t in toks])
        current: list[Tok] = []
        for t in toks:
            if current and abs(t.yc - current[-1].yc) > tol:
                out.append(sorted(current, key=lambda x: x.x0))
                current = []
            current.append(t)
        if current:
            out.append(sorted(current, key=lambda x: x.x0))
    return out


def _row_index(row: list[Tok]) -> tuple[str, list[tuple[int, int]], set[int]]:
    """Compact row text; per character its (token index, offset in token); word start positions."""
    text: list[str] = []
    where: list[tuple[int, int]] = []
    starts: set[int] = set()
    for i, t in enumerate(row):
        j = 0
        for k, ch in enumerate(t.text):
            if ch.isspace():
                continue
            if k == 0 or t.text[k - 1].isspace():
                starts.add(len(text))
            text.append(ch.lower())
            where.append((i, j))
            j += 1
    return "".join(text), where, starts


def _box(row: list[Tok], where: list[tuple[int, int]], start: int, end: int) -> tuple[Tok, list[Tok]]:
    """Box covering row characters [start, end); partial tokens are sliced proportionally."""
    (i0, c0), (i1, c1) = where[start], where[end - 1]
    first, last = row[i0], row[i1]
    n0, n1 = max(len(_compact(first.text)), 1), max(len(_compact(last.text)), 1)
    x0 = first.x0 + (first.x1 - first.x0) * c0 / n0
    x1 = last.x0 + (last.x1 - last.x0) * (c1 + 1) / n1
    covered = row[i0:i1 + 1]
    return Tok(first.page, x0, min(t.y0 for t in covered), x1, max(t.y1 for t in covered), ""), covered


def _bounded(text: str, starts: set[int], start: int, end: int) -> bool:
    """The hit must not begin or end in the middle of a word ("30" must not match "2030")."""
    ok_start = start in starts or not (text[start - 1].isalnum() and text[start].isalnum())
    ok_end = end == len(text) or end in starts or not (text[end - 1].isalnum() and text[end].isalnum())
    return ok_start and ok_end


# ----------------------------------------------------------------------------- locate
def locate(tokens: list[Tok], targets: list[Target]) -> list[dict[str, Any]]:
    """Find each target on the page. Returns anchors with page, box and (OCR) confidence."""
    indexed = [(row, *_row_index(row)) for row in rows(tokens)]
    anchors = []
    for target in targets:
        hits = []
        for order, (row, text, where, starts) in enumerate(indexed):
            labelled = any(_compact(lbl) in text for lbl in target.labels)
            for cand in {_compact(c) for c in target.candidates if c}:
                start = text.find(cand)
                while start != -1:
                    end = start + len(cand)
                    if _bounded(text, starts, start, end):
                        hits.append((labelled, order, row, where, start, end, text))
                    start = text.find(cand, start + 1)
        if not hits:
            continue
        labelled_hits = [h for h in hits if h[0]] or hits
        hit = max(labelled_hits, key=lambda h: h[1]) if target.prefer == "last" else \
            min(labelled_hits, key=lambda h: (h[1], h[4]))
        _labelled, _order, row, where, start, end, text = hit
        if start > 0 and text[start - 1] in "$€£" and where[start - 1][0] == where[start][0]:
            start -= 1  # include a currency sign printed in the same word
        box, covered = _box(row, where, start, end)
        if target.row:
            covered = [t for t in row if target.row == "all" or t.x1 > box.x0]
            box = Tok(box.page, box.x0, min(t.y0 for t in covered), max(t.x1 for t in covered),
                      max(t.y1 for t in covered), "")
        confs = [t.confidence for t in covered if t.confidence is not None]
        anchors.append({"key": target.key, "page": box.page,
                        "box": [round(box.x0, 2), round(box.y0, 2), round(box.x1, 2), round(box.y1, 2)],
                        "confidence": round(min(confs), 3) if confs else None})
    return anchors


# ----------------------------------------------------------------------------- spellings
_FR_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre",
              "octobre", "novembre", "décembre"]


def money_spellings(minor: int | None) -> list[str]:
    if minor is None:
        return []
    sign = "-" if minor < 0 else ""
    units, cents = divmod(abs(minor), 100)
    en = f"{units:,}.{cents:02d}"
    plain = f"{units}.{cents:02d}"
    fr = f"{units:,}".replace(",", " ") + f",{cents:02d}"
    return [sign + s for s in (en, plain, fr, fr.replace(" ", "."))] + [f"({en})"]


def date_spellings(iso: str | None) -> list[str]:
    if not iso:
        return []
    try:
        d = dt.date.fromisoformat(iso)
    except ValueError:
        return [iso]
    out = [iso, d.strftime("%Y/%m/%d"), d.strftime("%d/%m/%Y"), d.strftime("%m/%d/%Y"),
           d.strftime("%b %d, %Y"), d.strftime("%B %d, %Y"), d.strftime("%d %b %Y"), d.strftime("%d %B %Y"),
           f"{d.strftime('%b')} {d.day}, {d.year}", f"{d.strftime('%B')} {d.day}, {d.year}",
           f"{d.day} {_FR_MONTHS[d.month - 1]} {d.year}", d.strftime("%d.%m.%Y"), d.strftime("%Y.%m.%d")]
    return list(dict.fromkeys(out))


def targets_for(version: Any, lines: list[Any]) -> list[Target]:
    """Build the search list from an invoice version's stored values (what the UI shows)."""
    labels = {k: tuple(v) for k, v in FIELD_LABELS.items()}
    out = [
        Target("vendor_name", [version.vendor_name_raw or ""]),
        Target("invoice_number", [version.invoice_number_raw or ""], labels["invoice_number"]),
        Target("invoice_date", date_spellings(version.invoice_date), labels["invoice_date"]),
        Target("due_date", date_spellings(version.due_date), labels["due_date"]),
        Target("po_number", [version.po_number or ""], labels["po_number"]),
        Target("subtotal", money_spellings(version.subtotal_minor), tuple(SUBTOTAL_LABELS), "last"),
        Target("total", money_spellings(version.total_minor), ("total",), "last"),
    ]
    for i, tax in enumerate(version.taxes or []):
        kind = str(tax.get("kind") or "")
        out.append(Target(f"tax:{i}", money_spellings(tax.get("amount_minor")),
                          tuple(x for x in (kind, str(tax.get("label") or "").split("(")[0].strip()) if x), "last"))
    for line in lines:
        desc = (line.description or "").strip()
        out.append(Target(f"line:{line.line_no}", [desc, " ".join(desc.split()[:3])], row="right"))
    remit = version.remit or {}
    if remit.get("transit"):
        out.append(Target("remit", [f"Transit {remit['transit']}", str(remit["transit"])], ("acct", "transit"),
                          row="all"))
    return [t for t in out if any(t.candidates)]


# ----------------------------------------------------------------------------- documents
def _pdf_words(path: Path) -> tuple[list[dict[str, float]], list[Tok]]:
    import pymupdf

    pages, toks = [], []
    with pymupdf.open(path) as doc:
        for n, page in enumerate(doc, start=1):
            pages.append({"width": page.rect.width, "height": page.rect.height})
            for x0, y0, x1, y1, word, *_ in page.get_text("words"):
                toks.append(Tok(n, x0, y0, x1, y1, word))
    return pages, toks


def _ocr_words(path: Path) -> tuple[list[dict[str, float]], list[Tok]]:
    from app.services import ocr

    res = ocr.run(path)
    if res.status != "OK":
        return [], []
    images = ocr._load_images(path)  # same pixels OCR read, so the boxes line up
    pages = [{"width": float(img.shape[1]), "height": float(img.shape[0])} for img in images]
    toks = [Tok(t.page, *t.box, text=t.text, confidence=t.confidence) for t in res.tokens]
    return pages, toks


@lru_cache(maxsize=64)
def _layout_cached(path_str: str, mtime: float) -> tuple[str, list[dict[str, float]], list[Tok]]:
    path = Path(path_str)
    if path.suffix.lower() == ".pdf":
        pages, toks = _pdf_words(path)
        if sum(len(t.text) for t in toks) >= 20:
            return "text", pages, toks
    pages, toks = _ocr_words(path)
    return ("ocr" if toks else "none"), pages, toks


def layout(path: Path, version: Any, lines: list[Any]) -> dict[str, Any]:
    source, pages, toks = _layout_cached(str(path), path.stat().st_mtime)
    return {"source": source, "pages": pages, "anchors": locate(toks, targets_for(version, lines)) if toks else []}


def render_page(path: Path, page: int) -> tuple[bytes, str]:
    """PNG of one page for the viewer (images are returned as they are)."""
    if path.suffix.lower() != ".pdf":
        if page != 1:
            raise IndexError(page)
        return path.read_bytes(), "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    import pymupdf

    with pymupdf.open(path) as doc:
        if not 1 <= page <= doc.page_count:
            raise IndexError(page)
        pix = doc[page - 1].get_pixmap(matrix=pymupdf.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False)
        return pix.tobytes("png"), "image/png"
