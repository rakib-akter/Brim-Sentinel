# Backend implementation status (evidence-based, 2026-11-21)

Branch `feature/backend-completion`. Verified with `.venv/bin/python -m pytest` (103 passed),
`scripts/smoke.py` against a live uvicorn server on a fresh seed (SMOKE PASSED, audit chain valid),
and the three evaluation scripts in `docs/MODELS_AND_EVALUATION.md`.

| Area | Status | Evidence |
|---|---|---|
| FR-01 Intake | Done: emails.json + all 56 files, per-attachment drafts, SHA-256, idempotent re-import, upload endpoint (type/magic/size/filename checks, bounded read) | services/intake.py, tests |
| FR-02 Extraction | Done. Text-layer PDFs (EN/FR, 4 layouts) via PyMuPDF; **local OCR** (RapidOCR / ONNX Runtime) for PNG, JPEG and image-only PDFs with per-token confidence, de-skewed rows, provenance `ocr`, low-confidence values left UNKNOWN. Both dataset scans are OCR'd (fixtures only when OCR is unavailable). OCR eval: 96–99.7% field accuracy, 0 confident-wrong fields | services/ocr.py, extraction.py, tests/test_ocr.py, docs/eval/ocr_eval.json |
| FR-03 Coding | Done: supervised TF-IDF + logistic regression with temporal holdout, baselines and leave-one-vendor-out cold-start eval; SHA-256-verified artifact; unseen suppliers always reviewed; RapidFuzz kNN for supporting lines and fallback | app/ml/coding_model.py, services/coding.py, docs/eval/coding_model_metrics.json |
| FR-04 Validation | Done (vendor, identity look-alikes, arithmetic, tax by province, FX, dates, PO/P12/P13, contracts, bank changes/routes incl. authorized card reroute, department, coding, **split billing**) | services/validation.py |
| FR-05 Duplicates | Done (exact, reformatted, look-alike vendor, near with recurring exclusion, card-paid) with authorized dismissal | services/duplicates.py |
| FR-06 Approvals | Done (P01–P13, five edge cases, versions, sequential steps, one-person-one-step, **maker-checker on manual versions**) | services/approval_policy.py, approvals.py |
| FR-07 Payments | Done, simulated (prepare/release/settle/fail, idempotency, concurrency, SoD, NO_ELIGIBLE_RELEASER, method must match the invoice unless an authorized method change exists) | services/payments.py |
| FR-08 Audit | Done (append-only ORM guard, hash chain + verify, denied attempts in separate tx, CSV export with formula neutralization, Flight Recorder) | services/audit.py |
| FR-09 Vendors | Done: bank-change request/verify/authorize; onboarding + two-person activation; **card-route registry with independent verification** | services/bank.py, card_routes.py |
| §6.2 Virtual-card rerouting | Done, simulated: EFT → CARD method change per invoice version; finance-manager authorization independent of requester/route registrant/verifier; superseded by material edits; method-change parties cannot release | services/card_routes.py, tests/test_card_reroute.py |
| FR-10 backend | Done: role-scoped dashboard, plain status, one primary action, allowed_actions/blocked_reasons, wizard state (incl. method change) | services/views.py |
| Resolution Engine | Done | services/resolution.py |
| Anomaly | P1 + grouped noisy-OR with an as-of identity group (unverified bank change, remit ≠ master, look-alike, unknown supplier). Reproducible backtest and fixed-seed injection experiment. **Empirical-Bayes shrinkage, pricing/timing/pattern signals and reviewer refit are not implemented** | services/anomaly.py, scripts/evaluate_anomaly.py, tests/test_anomaly.py |
| Investigation | Done with AI off (unchanged) | services/investigation.py |
| Security | Demo identity only (no production auth, by design). Per-actor mutation rate limit, security headers, sandboxed document responses, sanitized correlation IDs, LIKE escaping, terminated identities refused | app/main.py, core/ratelimit.py, tests/test_security.py |

## Incoming batch on a fresh seed (`python -m scripts.report`)

31 ON_HOLD, 23 PENDING_APPROVAL, 2 CREDIT_RECORDED (totals unchanged from 1.0.0). Composition changed:
the three Orion "Network audit phase 1/2/3" invoices (CAD 14,543.10 together, each < 10k) are now held
for `SPLIT_BILLING_SUSPECTED` instead of — coincidentally — low kNN coding confidence; Keystone and
Lattice no longer carry `LOW_CODING_CONFIDENCE` (still held for PO / contract rate). Coding: 100 of
106 lines auto-suggested, 6 need review (unknown suppliers).

## Known gaps / decisions

* Applying the ML model changed which invoices need coding review; see the batch note above.
* `CREDIT_RECORDED` is a terminal lifecycle state for credit notes (not in the ARCHITECTURE list).
* The rate limiter is in-process (per worker) — adequate for the single-process demo only.
* New columns on `payment_routes` and the `payment_method_changes` table are created by `init_db`
  on a fresh database; an existing `brim.db` from 1.0.0 must be deleted and re-seeded (no Alembic).
* Card routes for card-preferred vendors are still seeded as labelled SYNTHETIC FIXTURE routes;
  routes for EFT vendors must be registered and independently verified in the app.
* Split-billing review uses a 14-day window, description similarity ≥ 80 and the P02 boundary; it
  considers only open workflow invoices, not historical paid ones.
* The author of a manual invoice version is excluded from its approval chain (escalated like P07),
  cannot dismiss its findings and cannot release it.
* Tax rates are applied by province in code (values match `tax_codes.csv`); not yet table-driven.
* Department/requester for email invoices are inferred from PO, then vendor history.
* Historical ledger rows are read-only; three historical invoices carry two payments each
  (AP-00117, AP-00278, AP-00338) — flagged, not altered.
* OCR quality is measured on synthetic rasterized scans; real-world scans may be worse. Whatever the
  quality, low-confidence fields stay UNKNOWN and arithmetic/tax/remit checks re-verify values.
* FastAPI `on_event("startup")` is deprecated but functional.
