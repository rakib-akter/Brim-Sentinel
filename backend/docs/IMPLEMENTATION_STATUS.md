# Backend implementation status (evidence-based, 2026-11-21)

Branch `agent/backend`. Verified with `.venv/bin/python -m pytest` (71 passed) and
`scripts/smoke.py` against a live uvicorn server on a fresh seed (passed).

| Area | Status | Evidence |
|---|---|---|
| FR-01 Intake | Done: emails.json + all 56 files, per-attachment drafts, SHA-256, idempotent re-import, upload endpoint (type/magic/size/filename checks) | services/intake.py, tests |
| FR-02 Extraction | Done for text-layer PDFs (EN/FR, 4 layouts, all 54 PDFs reconcile except genuinely wrong ones). **No OCR engine/vision in this environment**: 2 PNG scans use labelled `demo_fixture` transcriptions; unseen scans → `EXTRACTION_INCOMPLETE` + manual entry | services/extraction.py, fixtures/extraction |
| FR-03 Coding | Done with a substitute: `coding_model.py` is **not in the repo**, so a transparent RapidFuzz kNN over the ledger + novelty factor is used; < 0.70 → review; overrides need a reason and create a version. No accuracy metrics are claimed | services/coding.py |
| FR-04 Validation | Done (vendor, identity look-alikes, arithmetic, tax by province, FX, dates, PO/P12/P13, contracts, bank changes/routes, department, coding) | services/validation.py |
| FR-05 Duplicates | Done (exact, reformatted, look-alike vendor, near with recurring exclusion, card-paid) with authorized dismissal | services/duplicates.py |
| FR-06 Approvals | Done (P01–P13, five edge cases, versions, sequential steps, one-person-one-step) | services/approval_policy.py, approvals.py |
| FR-07 Payments | Done, simulated (prepare/release/settle/fail, idempotency, concurrency, SoD, NO_ELIGIBLE_RELEASER) | services/payments.py |
| FR-08 Audit | Done (append-only ORM guard, hash chain + verify, denied attempts in separate tx, CSV export, Flight Recorder) | services/audit.py, views.flight_recorder |
| FR-09 Vendors | Done: bank-change request/verify/authorize state machine, onboarding (pending) + two-person activation | services/bank.py |
| FR-10 backend | Done: role-scoped dashboard, plain status, one primary action, allowed_actions/blocked_reasons, wizard state | services/views.py |
| Resolution Engine | Done: persistent cases per blocking code, deterministic Path to Pay, resolve only by revalidation or documented rejection | services/resolution.py |
| Anomaly | P1 done (robust median/MAD, as-of, insufficient-history). P2 (shrinkage, noisy-OR, extra signals, injection experiment) **not implemented** | services/anomaly.py |
| Investigation | Done with AI off: 7 fixed read-only lookups, scope/ID checks, masking, 8-call cap, fact check, audit per lookup. No model provider is wired | services/investigation.py |

## Known gaps / decisions

* `CREDIT_RECORDED` added as a terminal lifecycle state for credit notes (not in the ARCHITECTURE list).
* Per-actor rate limiting on mutating endpoints is **not implemented**.
* Tax rates are applied by province in code (values match `tax_codes.csv`); not yet table-driven.
* Department/requester for email invoices are inferred from PO, then vendor history (labelled
  `department_source`); unknown → `DEPARTMENT_UNASSIGNED` hold.
* Historical ledger rows (426 invoices, 415 payments) are read-only reference data; three historical
  invoices carry two payments each (AP-00117, AP-00278, AP-00338) — flagged here, not altered.
* Virtual-card rerouting: gate exists (verified CARD route required, synthetic routes labelled);
  the explicit finance "method change" authorization step is not built.
* FastAPI `on_event("startup")` is deprecated but functional.
