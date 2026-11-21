# Models and evaluation — reproducible, measured on 2026-11-21

Everything here runs locally with no network or paid API. Numbers are copied from the JSON reports
in `docs/eval/`, which the commands below regenerate. The dataset is synthetic: none of these
numbers is a real-world accuracy, precision, recall or fraud-rate claim.

| Component | Command | Report |
|---|---|---|
| GL coding model (FR-03) | `python -m app.ml.coding_model train` (or `evaluate`) | `docs/eval/coding_model_metrics.json`, artifact `models/coding_model.{joblib,json}` |
| OCR (FR-02) | `python -m scripts.evaluate_ocr` (~2 min, 162 OCR runs) | `docs/eval/ocr_eval.json` |
| Anomaly priority (§5B) | `python -m scripts.evaluate_anomaly` (seeds a throw-away DB) | `docs/eval/anomaly_eval.json` |

## 1. GL coding — TF-IDF + logistic regression (`app/ml/coding_model.py`)

**Features.** TF-IDF on the line description (word 1–2-grams + `char_wb` 3–5-grams, sublinear tf) plus
one-hot vendor ID, vendor category, vendor default GL and ship-to province → multinomial logistic
regression (`C=10`, `random_state=0`). A second *text-only* pipeline serves suppliers the model has
never seen. Department is not predicted: it comes from the PO, then vendor history, else UNKNOWN.

**Split and leakage controls.** Temporal holdout — train on invoices dated ≤ 2026-08-31
(636 lines / 337 invoices), test on 2026-09-01 … 2026-10-24 (146 lines / 77 invoices). The split is by
invoice date, so no invoice spans both folds; vectorizers and encoders are fitted inside the sklearn
pipeline on the training fold only; rejected historical invoices are excluded; no target-derived
features (the vendor default GL comes from the vendor master). The script asserts the date and
invoice-ID disjointness before reporting.

| Temporal holdout (146 test lines, 21 GL classes) | Accuracy |
|---|---|
| Model (full features) | **100.0%** (top-3 100%, macro-F1 1.00) |
| Baseline: vendor default GL | 97.9% |
| Baseline: vendor's most frequent GL in training | 97.9% |
| Baseline: previous RapidFuzz kNN suggester | 100.0% |
| Lines ≥ 0.70 confidence (auto-suggested) | 100% of lines, 100% accurate |

The holdout is easy: recurring suppliers bill near-identical lines, and the vendor alone predicts
the GL ~98% of the time. The harder, more informative test is **cold start**:

| Leave-one-vendor-out (each test supplier scored by a text-only model trained without it) | |
|---|---|
| Text-only model accuracy | **81.5%** |
| RapidFuzz kNN accuracy (same protocol) | 69.9% |
| Coverage at the 0.70 review gate | 68.5% of lines |
| Accuracy on those auto-suggested lines | 100% |

**Policy in production.** Suppliers the model never saw are always capped at 0.69 (human review),
whatever the model says. Below 0.70 a line is `NEEDS_REVIEW` → `LOW_CODING_CONFIDENCE` hold. On the
supplied incoming batch the model auto-suggests 100 of 106 lines; 6 need review (unknown suppliers).
RapidFuzz still supplies the three supporting historical lines and is the full fallback if the model
cannot load.

**Artifact integrity.** The shipped model is refit on all eligible history (782 lines) after
evaluation; the manifest records its SHA-256, the scikit-learn version and the SHA-256 of the
training CSVs. The loader refuses to unpickle a file whose hash does not match and retrains in
memory (same deterministic procedure) if the artifact is missing or was built with another
scikit-learn version.

## 2. OCR — RapidOCR (PP-OCR on ONNX Runtime) (`app/services/ocr.py`)

Scans (PNG/JPEG) and image-only PDFs are OCR'd locally, tokens are grouped into de-skewed rows and
parsed by the same deterministic parser as text-layer PDFs (provenance `ocr`). Any value read from a
token below `OCR_MIN_CONFIDENCE` (0.80) is left blank and listed in `uncertain_fields`.

**Protocol.** All 54 incoming PDFs with a text layer are rasterized at 150 dpi (so no text layer
survives) in three variants and run through the production extraction path; the text-layer
extraction of the same file is the reference. Eleven financial fields per document (tax ID, invoice
number, dates, currency, subtotal, total, province, remit account, tax amounts, line amounts).

| Variant | Correct | Left UNKNOWN (safe) | **Wrong but confident** |
|---|---|---|---|
| PNG 150 dpi | 99.7% | 0.3% | **0** |
| JPEG quality 70 | 96.4% | 3.6% | **0** |
| Image-only PDF rotated 1° | 96.9% | 3.1% | **0** |

Both dataset scans (`scan_8049.png`, `scan_8749.png`) are now read by OCR and match the manual
transcriptions on every financial field; the `demo_fixture` transcriptions are used only when OCR is
disabled or unavailable. Arithmetic, tax, vendor-tax-ID and remit-account checks re-verify every OCR
value, so a misread digit becomes a hard hold rather than a payment.

## 3. Anomaly review priority (`app/services/anomaly.py`, method `robust_mad_grouped_noisy_or_v2`)

**No-look-ahead backtest** over the 426 historical invoices, each scored as of its own date using
only earlier ledger invoices and bank changes requested by then: 1 high, 1 medium, 173 low,
251 insufficient history (< 5 prior invoices). No invoice gets a bank-change signal — BC-009
(2026-10-27) post-dates the whole ledger, so AP-00173 (AT-36) is clean. These figures differ from
the PRD's reported v1.3 run (2 high / 71 medium / 353 low) because empirical-Bayes category shrinkage
is **not** implemented: suppliers with < 5 invoices get no amount score instead of a borrowed one.

**Injection experiment** (seed 20261121; all 175 ledger invoices with ≥ 5 prior invoices; one
planted anomaly per type; catch = band medium/high):

| Planted anomaly | Catch rate |
|---|---|
| Amount × 2 | 50.3% |
| Amount × 3 | 57.1% |
| Amount × 5 | 65.1% |
| Amount × 0.2 (small bill, weighted 35%) | 51.4% |
| Unverified bank change | 100% (by construction: hand-set strength 0.70 ≥ high) |
| Look-alike name + bank change | 100%, and scored identically to the bank change alone (AT-37) |

False-alarm rate on the same 175 unmodified invoices: **1.1% (2/175)**. Amount spikes are missed for
suppliers whose own history is very spread out (MAD-scaled z stays ≤ 3); that is the price of not
flagging normal freight variability and is why hard rules, not this score, block payments.
