"""Reproducible OCR evaluation on synthetic scans.

Every incoming PDF that has a text layer is rasterized (no text layer survives), optionally
degraded (JPEG re-encoding, slight rotation), then sent through the production extraction path
(`extraction.extract_document` → local OCR). The text-layer extraction of the same PDF is the
reference. For each financial field we count:

* correct          – OCR value equals the reference
* unknown          – OCR left the field blank / listed it as uncertain (safe: manual review)
* wrong_confident  – OCR produced a different value WITHOUT flagging it (the dangerous case)

Run:  python -m scripts.evaluate_ocr [--limit N] [--out docs/eval/ocr_eval.json]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import tempfile
from pathlib import Path

from app.core.config import BACKEND_DIR, get_settings
from app.services import extraction, ocr

FIELDS = ("vendor_tax_id", "invoice_number", "invoice_date", "due_date", "currency", "subtotal_minor",
          "total_minor", "ship_to_province", "remit_account_last4", "tax_amounts", "line_amounts")
VARIANTS = ("png_150dpi", "jpeg_q70_150dpi", "pdf_image_rotated_1deg")


def _values(ex: extraction.Extraction) -> dict[str, object]:
    return {
        "vendor_tax_id": ex.vendor_tax_id, "invoice_number": ex.invoice_number, "invoice_date": ex.invoice_date,
        "due_date": ex.due_date, "currency": ex.currency, "subtotal_minor": ex.subtotal_minor,
        "total_minor": ex.total_minor, "ship_to_province": ex.ship_to_province,
        "remit_account_last4": (ex.remit or {}).get("account_last4"),
        "tax_amounts": [t.get("amount_minor") for t in ex.taxes] or None,
        "line_amounts": [ln.amount_minor for ln in ex.lines] or None,
    }


def _uncertain(ex: extraction.Extraction, field: str) -> bool:
    u = set(ex.uncertain_fields)
    if field == "line_amounts":
        return "lines" in u or any(x.startswith("lines[") and x.endswith(".amount") for x in u)
    if field == "tax_amounts":
        return any(x.startswith("tax[") for x in u)
    if field == "remit_account_last4":
        return "remit" in u
    if field in {"subtotal_minor", "total_minor"}:
        return field.removesuffix("_minor") in u
    return field in u


def _render(pdf: Path, variant: str, out_dir: Path) -> Path:
    import pymupdf
    from PIL import Image

    with pymupdf.open(pdf) as doc:
        pix = doc[0].get_pixmap(dpi=150, alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if variant == "png_150dpi":
        p = out_dir / f"{pdf.stem}.png"
        img.save(p)
    elif variant == "jpeg_q70_150dpi":
        p = out_dir / f"{pdf.stem}.jpg"
        img.save(p, quality=70)
    else:
        rotated = img.rotate(1.0, expand=True, fillcolor="white")
        p = out_dir / f"{pdf.stem}_scan.pdf"
        rotated.save(p, "PDF", resolution=150)
    return p


def evaluate(limit: int | None = None) -> dict[str, object]:
    src = get_settings().data_dir / "incoming_invoices"
    pdfs = sorted(src.glob("*.pdf"))[: limit or None]
    per_variant: dict[str, dict[str, dict[str, int]]] = {}
    failures: list[dict[str, object]] = []
    docs = 0
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for pdf in pdfs:
            ref = extraction.parse_text(extraction.read_text_layer(pdf), "pdf_text")
            if ref.status != "EXTRACTED":
                continue
            docs += 1
            ref_vals = _values(ref)
            for variant in VARIANTS:
                path = _render(pdf, variant, tmpdir)
                ex = extraction.extract_document(path, path.name)
                stats = per_variant.setdefault(variant, {f: {"correct": 0, "unknown": 0, "wrong_confident": 0,
                                                              "reference_missing": 0} for f in FIELDS})
                got = _values(ex)
                for f in FIELDS:
                    if ref_vals[f] is None:
                        stats[f]["reference_missing"] += 1
                    elif got[f] == ref_vals[f]:
                        stats[f]["correct"] += 1
                    elif got[f] is None or _uncertain(ex, f) or ex.provenance != "ocr":
                        stats[f]["unknown"] += 1
                    else:
                        stats[f]["wrong_confident"] += 1
                        failures.append({"document": pdf.name, "variant": variant, "field": f,
                                         "reference": ref_vals[f], "ocr": got[f]})
    summary = {}
    for variant, stats in per_variant.items():
        tot = {k: sum(s[k] for s in stats.values()) for k in ("correct", "unknown", "wrong_confident")}
        n = sum(tot.values()) or 1
        summary[variant] = {"field_accuracy": round(tot["correct"] / n, 4),
                            "unknown_rate": round(tot["unknown"] / n, 4),
                            "wrong_confident_rate": round(tot["wrong_confident"] / n, 4), **tot}
    return {
        "evaluated_at": dt.date.today().isoformat(),
        "engine": ocr.ENGINE_NAME, "engine_version": ocr._engine_version(),
        "min_confidence": get_settings().ocr_min_confidence,
        "documents": docs, "variants": list(VARIANTS),
        "method": "Text-layer PDFs rasterized to scans; OCR extraction compared with the text-layer extraction "
                  "of the same file. Synthetic scans of synthetic invoices — not a real-world accuracy claim.",
        "summary": summary, "per_field": per_variant, "wrong_confident_examples": failures[:40],
        "downstream_safety": "Arithmetic (lines = subtotal, subtotal + tax = total), tax-rate, vendor tax-ID and "
                             "remit-account checks re-verify OCR values; any mismatch is a hard hold.",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", default=str(BACKEND_DIR / "docs" / "eval" / "ocr_eval.json"))
    args = ap.parse_args()
    if not ocr.available():
        print("OCR engine unavailable; nothing evaluated.")
        return 1
    res = evaluate(args.limit)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(res, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps(res["summary"], indent=2))
    print(f"documents: {res['documents']}; wrong_confident examples: {len(res['wrong_confident_examples'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
