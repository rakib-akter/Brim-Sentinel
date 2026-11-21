# API changelog (backend-owned; `backend/openapi.json` is authoritative)

## 1.1.0 — 2026-11-21

Additive; no existing field or endpoint was removed or renamed.

* **Virtual-card rerouting (simulated)**
  * `GET|POST /api/v1/vendors/{vendor_id}/card-routes` — list / register a card route (`CardRouteCreate`
    → `CardRouteOut`, starts `UNVERIFIED`).
  * `POST /api/v1/vendors/card-routes/{route_id}/verification` — independent callback
    (`CardRouteVerificationRequest`, same fields as bank-change verification).
  * `GET|POST /api/v1/invoices/{invoice_id}/payment-method-changes` — list / request EFT → CARD
    (`MethodChangeCreate {expected_version, to_method: "CARD", reason}` → `MethodChangeOut`).
  * `POST /api/v1/invoices/{invoice_id}/payment-method-changes/{change_id}/decision` —
    `{decision: AUTHORIZED|DECLINED, notes, expected_row_version?}` (finance_manager only).
  * Wizard `route_options[CARD]` now carries `method_change {id, state}` and `requires`.
* `POST /payments/prepare`: a `method` different from the invoice's now returns 422
  `METHOD_CHANGE_NOT_AUTHORIZED` (or `METHOD_CHANGE_REQUIRES_CARD` when a card change is authorized).
  New release denials: `METHOD_CHANGE_PARTY_CANNOT_RELEASE`, `VERSION_AUTHOR_CANNOT_RELEASE`.
* New finding codes: `SPLIT_BILLING_SUSPECTED` (blocking, dismissible). New dismissal denial
  `MAKER_CANNOT_DISMISS`; `SELF_DISMISSAL_DENIED` now applies to every finding.
* `InvoiceDetail.document_refs[].ocr` — OCR engine/version, mean confidence, threshold, low-confidence
  tokens and normalizations. `provenance` may now be `ocr`. Line `coding_method` is
  `tfidf_logreg_v1` (fallback `knn_rapidfuzz_v1`); `coding_detail` adds `model_variant`,
  `model_probability`, `knn_gl_account`, `knn_agrees`.
* Anomaly: `method_version` `robust_mad_grouped_noisy_or_v2`; `signals[]` may include identity signals
  (`unverified_bank_change`, `remit_account_differs_from_master`, `lookalike_vendor_identity`,
  `unknown_supplier`); `inputs.amount_component` and `inputs.groups` added; `as_of` is now the
  evaluation date. `risk_band` combines groups (an unknown supplier with no history is `medium`).
* 429 `RATE_LIMITED` (with `Retry-After`) on POST/PATCH beyond `RATE_LIMIT_PER_MINUTE` per actor.
* Terminated identities receive 403 `ACTOR_NOT_ACTIVE` on every request.
* Bank-change requests require a 3-digit institution, 5-digit transit and 5–12-digit account.

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
