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
.venv/bin/python -m pytest                                # 71 tests, ~4 s
.venv/bin/python -m scripts.export_openapi                # regenerates backend/openapi.json
```

Config (env vars, see `.env.example`): `BRIM_DATA_DIR` (default `../data/brim_ap_dataset`),
`DATABASE_URL` (default `sqlite:///backend/brim.db`), `DEMO_MODE` (default `true`),
`FRONTEND_ORIGIN` (comma-separated CORS origins; default `http://localhost:8080,…`).
Reset the demo: delete `backend/brim.db*` and re-seed.

## Demo identities — *Demo identity — not authentication*

Send `X-Demo-User-Id: <id>` (alias `X-Demo-Actor`). Accepted only when `DEMO_MODE=true`;
otherwise every request is 401. `GET /api/v1/demo-identities` lists all users.

| ID | Person | Role | Use in demo |
|---|---|---|---|
| U004 | Jordan Okafor | ap_clerk | intake, investigate, record callback, schedule payment |
| U005 | Sam Patel | ap_clerk | entered BC-009 → cannot verify it |
| U003 | Elise Tremblay | finance_manager | authorize route, dismiss candidates, release ≤ CAD 100k if not an approver |
| U002 | Marcus Webb | controller_admin | controller approvals, documented decisions |
| U001 | Priya Raman | controller_admin (CFO) | CFO step, releases when U002/U003 approved |
| U007 | Dev Malhotra | approver (Operations) | department approvals |
| U006 | Hannah Lindqvist | auditor | read-only audit, CSV export, hash-chain verify |
| U017 | Camille Dubois | employee | requester of Cascadia 1625 → self-approval denied |
| SVC-SENTINEL | service_ai | — | zero approve/verify/release permissions |

## What runs on seed

* 59 emails classified; 56 attachments → 56 drafts (EM-029 → 2); EM-058 missing-document work item;
  EM-056/057/059 non-payable. Re-import creates nothing new (Document unique on (email, SHA-256)).
* Every draft runs the pipeline: extraction (PyMuPDF text layer; the 2 PNG scans use labelled
  `demo_fixture` transcriptions because no OCR engine is installed) → coding → validation →
  duplicates → anomaly → approval routing → hold + Resolution Case, or PENDING_APPROVAL.
* Outcome on the supplied batch: 31 ON_HOLD, 23 PENDING_APPROVAL, 2 CREDIT_RECORDED
  (`python -m scripts.report` prints every invoice with its blocking codes and chain).

See `docs/` for `FINANCIAL_RULES.md`, `ACCEPTANCE_TESTS.md`, `IMPLEMENTATION_STATUS.md`, `API_CHANGELOG.md`.

## Layout

```
app/main.py               app factory, error envelope, denied-attempt auditing, CORS
app/api/                  thin routers (parse → authorize → service → serialize)
app/core/                 config, money (integer minor units), permissions, errors
app/db/                   models, session (WAL, BEGIN IMMEDIATE for writes), idempotent seed
app/schemas/dto.py        Pydantic DTOs → openapi.json
app/services/             extraction, intake, coding, validation, duplicates, anomaly,
                          approval_policy, approvals, payments, bank, resolution, investigation,
                          lifecycle, audit, pipeline (command handler), views (read services)
app/integrations/ai_gateway.py   the only module allowed to call a model (disabled)
fixtures/extraction/      labelled demo_fixture transcriptions for the 2 scanned PNGs
scripts/                  seed, smoke, report, export_openapi
tests/                    pytest (units, policy matrix, dataset fixtures, API workflows, agent safety)
```
