"""ExtractionService: text-first extraction with explicit provenance.

Pipeline: PyMuPDF text layer (`pdf_text`) → local OCR for scans and image-only PDFs (`ocr`,
see `services/ocr.py`) → labelled demo fixture transcription only if OCR is unavailable
(`demo_fixture`) → otherwise NEEDS_MANUAL_EXTRACTION. Fixture output is never labelled `ocr`.
Unreadable, ambiguous or low-confidence values are returned as None and listed in
`uncertain_fields`; nothing is guessed."""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.money import parse_money, to_minor
from app.services import ocr as ocr_svc

PROVINCES = "AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT"
_PROV_RE = re.compile(rf"\b({PROVINCES})\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d\b")
# OCR drops spaces ("MontrealQCH3B4W8"): accept a province + postal code at the end of the line.
_PROV_OCR_RE = re.compile(rf"({PROVINCES})\s*[A-Z]\d[A-Z]\s?\d[A-Z]\d\s*$")
_REMIT_RE = re.compile(r"Inst\.?\s*(\d{3})\s*Transit\s*(\d{5})\s*Acct\s*(\d{5,12})\b", re.I)
_TAXID_RE = re.compile(r"(?:GST/HST|TPS/TVH)\s*(\d{9}RT\d{4})")
_QSTID_RE = re.compile(r"(?:QST|TVQ)\s*(\d{10}TQ\d{4})")
MIN_TEXT_LAYER_CHARS = 20
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_INJECTION_RE = re.compile(
    r"(ignore (all|any|previous|prior) instructions|approve this invoice|mark (this|as) (paid|verified|approved)|"
    r"system prompt|release (the )?payment immediately|you are an ai)", re.I)

FIELD_LABELS: dict[str, list[str]] = {
    "invoice_number": ["invoice number", "invoice #", "invoice no.", "invoice no", "inv no", "facture n°",
                       "facture no", "no de facture", "n° de facture", "numéro de facture"],
    "invoice_date": ["issued", "date", "invoice date", "date de facture", "date de la facture"],
    "due_date": ["due by", "due date", "payment due", "due", "échéance", "date d'échéance"],
    "terms": ["terms", "payment terms", "conditions"],
    "po_number": ["po ref", "po #", "your po", "customer po", "po", "bon de commande", "n° bc"],
    "credit_ref": ["credit note ref", "réf. note de crédit"],
}
SUBTOTAL_LABELS = {"subtotal", "sous-total", "sous total"}
LINE_HEADER_END = {"amount", "montant"}

DOC_TYPES = {"INVOICE": "invoice", "TAX INVOICE": "invoice", "FACTURE": "invoice",
             "CREDIT NOTE": "credit_note", "NOTE DE CRÉDIT": "credit_note", "NOTE DE CREDIT": "credit_note"}
LINE_HEADER_WORDS = {"description", "qty", "quantity", "qté", "unit price", "unitprice", "prix unitaire",
                     "prixunitaire"}
BILL_TO_LABELS = {"bill to", "billto", "facturer à", "facturerà", "facturer a", "facturera"}


def _compact(s: str) -> str:
    return re.sub(r"\s+", "", s).lower()


_LABEL_INDEX = {_compact(lbl): fname for fname, labels in FIELD_LABELS.items() for lbl in labels}
_DOC_TYPES_COMPACT = {_compact(k): v for k, v in DOC_TYPES.items()}
_SUBTOTAL_COMPACT = {_compact(x) for x in SUBTOTAL_LABELS}


@dataclass
class ExtractedLine:
    line_no: int
    description: str
    quantity: str
    unit_price_minor: int | None
    amount_minor: int | None


@dataclass
class Extraction:
    provenance: str  # pdf_text | demo_fixture | manual | none
    status: str  # EXTRACTED | NEEDS_MANUAL_EXTRACTION
    vendor_name: str | None = None
    vendor_tax_id: str | None = None
    vendor_qst_id: str | None = None
    document_type: str | None = None
    invoice_number: str | None = None
    invoice_date: str | None = None
    due_date: str | None = None
    terms: str | None = None
    po_number: str | None = None
    credit_ref: str | None = None
    bill_to: str | None = None
    ship_to_province: str | None = None
    currency: str | None = None
    subtotal_minor: int | None = None
    taxes: list[dict[str, Any]] = field(default_factory=list)
    total_minor: int | None = None
    lines: list[ExtractedLine] = field(default_factory=list)
    remit: dict[str, Any] = field(default_factory=dict)
    language: str | None = None
    uncertain_fields: list[str] = field(default_factory=list)
    evidence: dict[str, str] = field(default_factory=dict)
    injection_phrases: list[str] = field(default_factory=list)
    raw_text: str = ""
    ocr: dict[str, Any] = field(default_factory=dict)


def read_text_layer(path: Path) -> str:
    if path.suffix.lower() != ".pdf":
        return ""
    import pymupdf  # local import keeps module import cheap

    with pymupdf.open(path) as doc:
        return "".join(page.get_text() for page in doc)


def fixture_text(filename: str) -> str | None:
    p = get_settings().fixtures_dir / "extraction" / f"{filename}.txt"
    return p.read_text(encoding="utf-8") if p.exists() else None


def _norm_label(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().rstrip(":").strip()).lower()


def _date(raw: str | None, extraction: Extraction, name: str) -> str | None:
    if raw is None:
        return None
    raw = raw.strip()
    if _ISO_DATE.match(raw):
        try:
            dt.date.fromisoformat(raw)
            return raw
        except ValueError:
            pass
    extraction.uncertain_fields.append(name)  # ambiguous/unparseable dates are UNKNOWN
    return None


def _money(raw: str, extraction: Extraction, name: str) -> int | None:
    d = parse_money(raw)
    if d is None:
        extraction.uncertain_fields.append(name)
        return None
    return to_minor(d)


def parse_text(text: str, provenance: str, line_conf: dict[str, float] | None = None,
               min_conf: float | None = None) -> Extraction:
    """Parse a text layer / OCR reading. `line_conf` maps a line to its recognition confidence;
    values read from a line below `min_conf` are left blank and listed as uncertain."""
    ex = Extraction(provenance=provenance, status="EXTRACTED", raw_text=text)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    threshold = min_conf if min_conf is not None else 0.0

    def ok(*cells: str) -> bool:
        return line_conf is None or all(line_conf.get(c.strip(), 1.0) >= threshold for c in cells)

    def low(name: str) -> None:
        ex.uncertain_fields.append(name)

    if len(lines) < 5:
        ex.status = "NEEDS_MANUAL_EXTRACTION"
        ex.uncertain_fields.append("document")
        return ex

    ex.injection_phrases = sorted({m.group(0) for m in _INJECTION_RE.finditer(text)})
    if ok(lines[0]):
        ex.vendor_name = lines[0]
    else:
        low("vendor_name")
    ex.evidence["vendor_name"] = lines[0]
    lower_text = text.lower()
    ex.language = "fr" if any(k in lower_text for k in ("facture", "sous-total", "échéance", "montant")) else "en"

    bill_idx = next((i for i, ln in enumerate(lines) if _compact(ln) in BILL_TO_LABELS), None)
    header_zone = lines[: bill_idx if bill_idx is not None else 12]
    for ln in header_zone:
        if m := _TAXID_RE.search(ln):
            if ok(ln):
                ex.vendor_tax_id = m.group(1)
            else:
                low("vendor_tax_id")
        if m := _QSTID_RE.search(ln):
            if ok(ln):
                ex.vendor_qst_id = m.group(1)
            else:
                low("vendor_qst_id")
        if _compact(ln) in _DOC_TYPES_COMPACT and ex.document_type is None:
            ex.document_type = _DOC_TYPES_COMPACT[_compact(ln)]
            ex.evidence["document_type"] = ln
        if ln == "Invoice" and ex.document_type is None:
            ex.document_type = "invoice"

    # Labelled fields ("Label: value"), first occurrence wins.
    for ln in lines:
        if ":" not in ln:
            continue
        label, _, value = ln.partition(":")
        fname_hit = _LABEL_INDEX.get(_compact(_norm_label(label)))
        for fname, _labels in FIELD_LABELS.items():
            if fname == fname_hit and fname not in ex.evidence:
                ex.evidence[fname] = ln
                v = value.strip()
                if not ok(ln):
                    low(fname)
                    break
                if fname == "invoice_number":
                    ex.invoice_number = v or None
                elif fname == "invoice_date":
                    ex.invoice_date = _date(v, ex, "invoice_date")
                elif fname == "due_date":
                    ex.due_date = _date(v, ex, "due_date") if v else None
                elif fname == "terms":
                    ex.terms = v or None
                elif fname == "po_number":
                    ex.po_number = v or None
                elif fname == "credit_ref":
                    ex.credit_ref = v or None
                break

    if bill_idx is not None and bill_idx + 2 < len(lines) and ok(lines[bill_idx + 2]):
        ex.bill_to = lines[bill_idx + 2]
        ex.evidence["bill_to"] = f"{lines[bill_idx + 1]} — {lines[bill_idx + 2]}"
        if m := _PROV_RE.search(lines[bill_idx + 2]):
            ex.ship_to_province = m.group(1)
        elif provenance == "ocr" and (m := _PROV_OCR_RE.search(lines[bill_idx + 2])):
            ex.ship_to_province = m.group(1)
    if ex.ship_to_province is None:
        ex.uncertain_fields.append("ship_to_province")

    # Line items: 4-line groups between the 'Amount' header and the subtotal label.
    try:
        start = next(i for i, ln in enumerate(lines) if ln.lower() in LINE_HEADER_END) + 1
        end = next(i for i in range(start, len(lines)) if _compact(lines[i]) in _SUBTOTAL_COMPACT)
    except StopIteration:
        start = end = None
    if start is None or end is None:
        ex.uncertain_fields.append("lines")
    else:
        # OCR may order a header cell after 'Amount' when the header row is slightly skewed.
        while start < end and lines[start].lower() in LINE_HEADER_WORDS:
            start += 1
        block = lines[start:end]
        if len(block) % 4 != 0:
            ex.uncertain_fields.append("lines")
        for n, i in enumerate(range(0, len(block) - len(block) % 4, 4), start=1):
            desc, qty, unit, amt = block[i : i + 4]
            if not ok(desc):
                low(f"lines[{n}].description")
            if not ok(qty, unit, amt):
                low("lines")  # a numeric cell could not be read reliably → whole table UNKNOWN
            ex.lines.append(ExtractedLine(
                line_no=n, description=desc, quantity=qty.replace(",", "."),
                unit_price_minor=_money(unit, ex, f"lines[{n}].unit_price") if ok(unit) else None,
                amount_minor=_money(amt, ex, f"lines[{n}].amount") if ok(amt) else None,
            ))
        # Subtotal, taxes, total: (label, amount) pairs.
        j = end
        while j + 1 < len(lines):
            label, val = lines[j], lines[j + 1]
            ll = label.lower()
            readable = ok(label, val)
            if _compact(label) in _SUBTOTAL_COMPACT:
                ex.subtotal_minor = _money(val, ex, "subtotal") if readable else None
                if not readable:
                    low("subtotal")
                ex.evidence["subtotal"] = f"{label} {val}"
            elif ll.startswith("total"):
                cur = label.split()[-1].upper()
                cur = cur[-3:] if provenance == "ocr" and cur.startswith("TOTAL") else cur  # "TOTALCAD"
                ex.currency = cur if cur in {"CAD", "USD"} and ok(label) else None
                if ex.currency is None:
                    ex.uncertain_fields.append("currency")
                ex.total_minor = _money(val, ex, "total") if ok(val) else None
                if not ok(val):
                    low("total")
                ex.evidence["total"] = f"{label} {val}"
                break
            else:
                rate = re.search(r"\(([\d.,]+)\s*%\)", label)
                kind = label.split("(")[0].strip().upper()
                kind = {"TPS": "GST", "TVQ": "QST", "TVH": "HST"}.get(kind, kind)
                if not readable:
                    low(f"tax[{label}]")
                ex.taxes.append({
                    "label": label, "kind": kind,
                    "rate_pct": rate.group(1).replace(",", ".") if rate and readable else None,
                    "amount_minor": _money(val, ex, f"tax[{label}]") if readable else None,
                })
            j += 2

    remit_m = _REMIT_RE.search(text)
    remit_line = next((ln for ln in lines if remit_m and remit_m.group(0) in ln), None)
    if remit_m and remit_line is not None and not ok(remit_line):
        ex.uncertain_fields.append("remit")  # bank digits must never come from a weak reading
    elif m := remit_m:
        ex.remit = {"method": "EFT", "institution": m.group(1), "transit": m.group(2),
                    "account_last4": m.group(3)[-4:], "account_full": m.group(3)}
        ex.evidence["remit"] = m.group(0).replace(m.group(3), "****" + m.group(3)[-4:])
    elif "credit card" in lower_text or "carte de crédit" in lower_text:
        ex.remit = {"method": "CARD"}
        ex.evidence["remit"] = "Pay by credit card at our online portal."
    else:
        ex.uncertain_fields.append("remit")

    if ex.total_minor is not None and ex.total_minor < 0:
        ex.document_type = "credit_note"
    for required in ("invoice_number", "invoice_date", "total_minor", "currency"):
        if getattr(ex, required) is None and required not in ex.uncertain_fields:
            ex.uncertain_fields.append(required)
    return ex


def extract_document(path: Path, filename: str) -> Extraction:
    text = read_text_layer(path)
    if len(text.strip()) >= MIN_TEXT_LAYER_CHARS:
        return parse_text(text, "pdf_text")
    ocr_meta: dict[str, Any] = {}
    if path.suffix.lower() in {".pdf", *ocr_svc.IMAGE_SUFFIXES}:
        res = ocr_svc.run(path)
        ocr_meta = {"status": res.status, "message": res.message}
        if res.status == "OK":
            ex = parse_text("\n".join(res.lines), "ocr", line_conf=res.confidence_map(),
                            min_conf=get_settings().ocr_min_confidence)
            ex.ocr = {**ocr_meta, **res.provenance()}
            return ex
    fx = fixture_text(filename)
    if fx:
        ex = parse_text(fx, "demo_fixture")
        ex.ocr = ocr_meta
        return ex
    ex = Extraction(provenance="none", status="NEEDS_MANUAL_EXTRACTION")
    ex.uncertain_fields = ["document"]
    ex.ocr = ocr_meta
    return ex


def normalize_invoice_number(raw: str | None) -> str | None:
    if not raw:
        return None
    return re.sub(r"[^A-Z0-9]", "", raw.upper()) or None


def invoice_number_core(raw: str | None) -> str | None:
    """Reformat-insensitive core: drop letter prefixes/suffix markers and leading zeros
    ('INV-01561' → '1561', 'FA-000318' → '318', '000903-A' → '903A')."""
    n = normalize_invoice_number(raw)
    if not n:
        return None
    n = re.sub(r"^(INV|FA|CN|NO|AU|TR|HA|GR|KE|AL|PI|PR)", "", n)
    n = re.sub(r"^\d{2}(?=\d)", lambda m: m.group(0), n)
    return n.lstrip("0") or "0"


def as_decimal_rate(rate_pct: str | None) -> Decimal | None:
    try:
        return Decimal(rate_pct) / 100 if rate_pct else None
    except Exception:  # noqa: BLE001
        return None
