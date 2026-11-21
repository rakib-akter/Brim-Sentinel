# API changelog (backend-owned; `backend/openapi.json` is authoritative)

## 1.0.0 — 2026-11-21 (initial contract)

* Base path `/api/v1`; `GET /health`; `GET /openapi.json` (also committed as `backend/openapi.json`).
* Identity: `X-Demo-User-Id` header (alias `X-Demo-Actor` accepted for the current frontend draft
  client). Only when `DEMO_MODE=true`; otherwise 401. Label: "Demo identity — not authentication."
* Error envelope: `{"error": {"code", "message", "details", "correlation_id"}}`; 401/403/404/409/422.
* Every mutation requires `expected_version` (invoice) or `expected_row_version` (case/bank change)
  and returns the updated resource including `allowed_actions` and `blocked_reasons`.
* Release requires `Idempotency-Key` header.

### Notes for the frontend owner
* The draft client in `frontend/src/lib/api/http-api.ts` calls `/home`, `/invoices`, `/notifications`,
  `/invoices/uploads`. Backend equivalents: `GET /api/v1/dashboard`, `GET /api/v1/invoices`,
  (no notifications endpoint yet — use dashboard `needs_attention` / `work_items`),
  `POST /api/v1/invoices/upload` (multipart `file`). Money is integer minor units everywhere.
* Mock demo users in `frontend/src/lib/domain/roles.ts` do not match `users.csv`
  (e.g. U007 is Dev Malhotra, Operations Manager). Use `GET /api/v1/demo-identities`.
* Lifecycle states are upper-case (`ON_HOLD`, `PENDING_APPROVAL`, …, `CREDIT_RECORDED`);
  `plain_status` and `primary_action` are provided for Simple Mode.
