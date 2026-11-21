# Brim Sentinel — backend

FastAPI + SQLAlchemy 2 + SQLite (WAL) modular monolith. **All payments are SIMULATED.** No paid
AI API and no payment rail is ever contacted (`AI_ENABLED=false` by default; no provider client ships).

## Run

```bash
cd backend
uv venv --python 3.12 .venv            # or: python3.12 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python -m scripts.seed       # idempotent: master data, 426-invoice ledger, 59-email inbox
.venv/bin/uvicorn app.main:app --reload --port 8000
# in another terminal, against a FRESH seed:
.venv/bin/python -m scripts.smoke http://127.0.0.1:8000   # Detect → Resolve → Settle → Explain
.venv/bin/python -m scripts.report                        # per-invoice outcome of the incoming batch
.venv/bin/python -m pytest                                # 103 tests, ~15 s
.venv/bin/python -m scripts.export_openapi                # regenerates backend/openapi.json
# reproducible evaluations (see docs/MODELS_AND_EVALUATION.md)
.venv/bin/python -m app.ml.coding_model train             # temporal holdout + refit + artifact
.venv/bin/python -m scripts.evaluate_ocr                  # OCR on rasterized invoices (~2 min)
.venv/bin/python -m scripts.evaluate_anomaly              # no-look-ahead backtest + injection test
```

Upgrading from 1.0.0: delete `backend/brim.db*` and re-seed (new tables/columns, no migrations).

Config (env vars, see `.env.example`): `BRIM_DATA_DIR` (default `../data/brim_ap_dataset`),
`DATABASE_URL` (default `sqlite:///backend/brim.db`), `DEMO_MODE` (default `true`),
`FRONTEND_ORIGIN` (comma-separated CORS origins; default `http://localhost:8080,…`), `OCR_ENABLED`
(default `true`), `OCR_MIN_CONFIDENCE` (default `0.80`), `RATE_LIMIT_PER_MINUTE` (default `120`, `0` off).
Reset the demo: delete `backend/brim.db*` and re-seed.

## Demo identities — *Demo identity — not authentication*

Send `X-Demo-User-Id: <id>` (alias `X-Demo-Actor`). Accepted only when `DEMO_MODE=true`;
otherwise every request is 401. `GET /api/v1/demo-identities` lists all users.

| ID | Person | Role | Use in demo |
|---|---|---|---|
| U004 | Jordan Okafor | ap_clerk | intake, investigate, record callback, schedule payment |
| U005 | Sam Patel | ap_clerk | entered BC-009 → cannot verify it; verifies card routes U004 registered |
| U003 | Elise Tremblay | finance_manager | authorize route / payment-method change, dismiss candidates, release ≤ CAD 100k if independent |
| U002 | Marcus Webb | controller_admin | controller approvals, documented decisions |
| U001 | Priya Raman | controller_admin (CFO) | CFO step, releases when U002/U003 approved |
| U007 | Dev Malhotra | approver (Operations) | department approvals |
| U006 | Hannah Lindqvist | auditor | read-only audit, CSV export, hash-chain verify |
| U017 | Camille Dubois | employee | requester of Cascadia 1625 → self-approval denied |
| SVC-SENTINEL | service_ai | — | zero approve/verify/release permissions |

## What runs on seed

* 59 emails classified; 56 attachments → 56 drafts (EM-029 → 2); EM-058 missing-document work item;
  EM-056/057/059 non-payable. Re-import creates nothing new (Document unique on (email, SHA-256)).
* Every draft runs the pipeline: extraction (PyMuPDF text layer; the 2 PNG scans and any uploaded
  PNG/JPEG/image-only PDF are read by **local OCR**, provenance `ocr`) → coding (TF-IDF + logistic
  regression; 100 of 106 lines auto-suggested) → validation → duplicates → anomaly → approval routing
  → hold + Resolution Case, or PENDING_APPROVAL.
* Outcome on the supplied batch: 31 ON_HOLD, 23 PENDING_APPROVAL, 2 CREDIT_RECORDED
  (`python -m scripts.report` prints every invoice with its blocking codes and chain).

## Virtual-card rerouting demo (simulated)

Paper Trail (V024, invoice `IN-EM-024-1`) bills by EFT but accepts card:
1. U004 `POST /vendors/V024/bank-change-requests` → the invoice is held (`BANK_CHANGE_UNVERIFIED`).
2. U004 `POST /vendors/V024/card-routes` (merchant reference from the vendor) → UNVERIFIED.
3. U005 `POST /vendors/card-routes/{id}/verification` (trusted contact `VC-V024-EMAIL`) → VERIFIED.
4. U004 `POST /invoices/IN-EM-024-1/payment-method-changes` → REQUESTED (a request authorizes nothing).
5. U003 `POST …/payment-method-changes/{id}/decision {"decision":"AUTHORIZED"}` → revalidated,
   PENDING_APPROVAL; EFT to the new account stays blocked.
6. U011 approves; U004 prepares (CARD only); U002 releases (U003 authorized the change → cannot).

See `docs/` for `FINANCIAL_RULES.md`, `ACCEPTANCE_TESTS.md`, `IMPLEMENTATION_STATUS.md`, `API_CHANGELOG.md`,
`MODELS_AND_EVALUATION.md`.

## Layout

```
app/main.py               app factory, error envelope, denied-attempt auditing, CORS
app/api/                  thin routers (parse → authorize → service → serialize)
app/core/                 config, money (integer minor units), permissions, errors
app/db/                   models, session (WAL, BEGIN IMMEDIATE for writes), idempotent seed
app/schemas/dto.py        Pydantic DTOs → openapi.json
app/services/             extraction, ocr, intake, coding, validation, duplicates, anomaly, card_routes,
                          approval_policy, approvals, payments, bank, resolution, investigation,
                          lifecycle, audit, pipeline (command handler), views (read services)
app/ml/coding_model.py    FR-03 TF-IDF + logistic regression (train/evaluate/suggest CLI)
app/integrations/ai_gateway.py   the only module allowed to call a model (disabled)
models/                   SHA-256-verified coding model artifact + manifest
fixtures/extraction/      labelled demo_fixture transcriptions (used only if OCR is unavailable)
docs/eval/                coding, OCR and anomaly evaluation reports (JSON)
scripts/                  seed, smoke, report, export_openapi, evaluate_ocr, evaluate_anomaly
tests/                    pytest (units, policy matrix, dataset fixtures, API workflows, agent safety)
```
