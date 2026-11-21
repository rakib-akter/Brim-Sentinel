# BRIM SENTINEL — AUTONOMOUS ENGINEERING EXECUTION BRIEF

**Version:** 2.0 | **Project:** CodeJam 2026 — Brim Financial Track | **Owner:** Solo builder

> **EXECUTION INSTRUCTION:** You are the lead implementation agent acting as a senior staff engineer and technical project manager. Deliver a working, tested Brim Sentinel application from the existing repository. Delegate backend work to Claude Code and frontend work to Codex when both are available. Do not stop for routine decisions or ask the owner to design features, write code, review every intermediate step, or manually coordinate agents. Make sensible, reversible choices, record them, implement, test, and integrate. Ask for human action only when genuinely unavoidable (missing credentials/access, destructive external actions, or required real-world financial verification). Do not claim completion without running checks.

## 0. First instructions — read before editing

1. Repository: `https://github.com/rakib-akter/Brim-Sentinel`. Work in the **existing checkout** and inspect `git status`, branch, tree, package scripts, existing routes/components, tests, and backend before making changes. Never delete or replace the imported Lovable UI wholesale.
2. **Authoritative specification:** `Brim-Sentinel-PRD-v1.4(1).pdf` (26 pages, supplied separately). Locate it in the repository or supplied workspace. If absent, request or retrieve the file; **do not claim to have read an unavailable PRD**. The v1.4 amendments override conflicting v1.3 baseline sections. Read the entire PDF, especially §§3–10, §4A, §§5/5A/5B, §§11–12, and v1.4 amendments A1–A8. This brief operationalizes, but does not supersede, the PRD.
3. Inspect existing data and assets: `README.md`, `coding_model.py`, any `anomaly.py`/tests, `emails.json`, `*.csv`, and `incoming_invoices/` if supplied. The synthetic dataset may be **outside the Git repository**. Locate it via configurable path (`BRIM_DATA_DIR`), and never silently invent missing files. If the PDF/image batch is absent, build a fixture-backed demo and a real upload pipeline, clearly reporting the untested document coverage.
4. Preserve existing frontend source under `frontend/`, including visual components, routes, theme, mascot images and any API abstraction. The imported Lovable project uses **React + TypeScript + Vite**; despite the PRD's Next.js preference, **do not migrate frameworks** unless a concrete blocker makes it essential. Record this pragmatic deviation in `ARCHITECTURE.md`.
5. Never assume existing UI mock data represents actual backend state. Replace mocks through a typed API adapter; no financial permission, validation, approval, or payment decision may be enforced exclusively in the browser.
6. Create a dedicated working branch or worktree; do not force-push or overwrite unrelated work. If the environment has no agent orchestration, implement sequentially while preserving the same ownership boundaries. Never pretend a second agent was invoked if it was not.
7. Before coding, inspect the repo and write a concise implementation inventory and gap map in `IMPLEMENTATION_STATUS.md`. Then **execute** the work; do not stop after writing a plan.

## 1. Mission, user experience, and acceptance contract

Build **Brim Sentinel** for fictional customer **Harborline Logistics**, tagline **“Detect. Resolve. Settle. Explain.”** A nontechnical AP employee should be able to import an invoice, see what needs attention, understand the evidence, follow the safest next action, obtain proper human approvals, simulate an authorized payment, and replay an accurate audit trail.

**Definition of done:**
- FR-01 through FR-10 demonstrably work against seeded data and supported uploaded documents.
- Critical negative API tests prove unauthorized approvals, bank changes and releases are blocked.
- A real stored invoice can complete a permitted Detect → Resolve → Settle → Explain journey, or remain safely held when authorization is impossible.
- Backend states drive the UI; refresh/restart does not erase the case, decision or audit history.
- `pytest`, frontend build/tests, and a Playwright critical-path smoke test run successfully, or exact failures and blockers are documented with no false success claims.
- Seed/import is repeatable and idempotent; no real payment rails are contacted.
- A judge can follow `README.md` to start the system locally, switch labeled **demo identities**, reproduce key scenarios and inspect evidence.

**Never compromise:** no real money; no fabricated verified bank/merchant route; no AI financial authority; no self-approval; no approver releasing the same invoice; one human per approval step per invoice version; no payment through unresolved hard holds; no payment of credit notes; no duplicated simulated releases; no stale approval after material edits; no hidden unknown-as-pass behavior.

## 2. Agent management and work allocation

**Lead/orchestrator:** owns architecture, specification fidelity, API contract, cross-agent integration, release gates, documentation and final verification. The lead must inspect actual tool availability and use the available agents honestly.

**Claude Code — backend owner** (`backend/`, `scripts/`, data models, migrations, `tests/backend/`):
- FastAPI modular monolith, SQLAlchemy, Pydantic, SQLite and schema/migrations.
- Import/seed, extraction, coding, validation, duplicate detection, approval routing, vendor controls, resolution, simulated payments, audit, anomaly engine, bounded investigation.
- Server-side identity/scope enforcement, idempotency, audit, policy tests and OpenAPI generation.

**Codex — frontend owner** (`frontend/`, UI and Playwright tests):
- Preserve and improve existing Lovable light fintech UI; connect generated typed client; implement invoice details, resolution wizard, approvals, payments, vendors, cases and audit.
- Implement accessible task-first UX, evidence viewers, Flight Recorder, role-specific states and empty/error/loading states.
- Ensure the frontend build, component tests and Playwright flows pass.

**Coordination protocol:**
1. Lead creates `ARCHITECTURE.md`, `FINANCIAL_RULES.md`, `ACCEPTANCE_TESTS.md`, and a draft `API_CONTRACT.yaml` with canonical DTOs and state names. Backend-generated `openapi.json` becomes authoritative.
2. Freeze initial endpoints/types before parallel implementation. Assign distinct Git worktrees (`../brim-backend`, `../brim-frontend`) and branches when possible; each agent owns its directories. Do not have two agents edit the same contract or shared configuration simultaneously.
3. Use small, meaningful commits and communicate contract changes through `API_CHANGELOG.md`. Regenerate the frontend client when backend OpenAPI changes.
4. Lead integrates branches, resolves conflicts, runs tests and performs negative-path security checks. Never auto-merge failing work or claim human approval occurred.
5. Keep `IMPLEMENTATION_STATUS.md` current: feature, actual implementation evidence, tests, blocker, owner and next action. Do not write ceremonial progress updates.

## 3. Architecture and local developer experience

**Frontend:** existing Vite/React/TypeScript, Tailwind/shadcn and existing router; React Query or current project data-fetching pattern; `@xyflow/react` only if optional graph is eventually justified. Maintain existing package manager/lockfile where practical. Use OpenAPI-generated TypeScript types/client or a type-safe thin wrapper generated from backend schema.

**Backend:** Python 3.11+; FastAPI; Pydantic v2; SQLAlchemy 2; Alembic if reasonable; SQLite for demo; PyMuPDF for text-first PDF parsing; OCR/vision fallback with cached fixtures; scikit-learn for coding; RapidFuzz for candidate generation; pytest. Prefer a straightforward synchronous implementation where it reduces failure risk. Use Decimal or integer cents for every monetary calculation and compare in CAD after stored invoice-date FX conversion. No binary float for payment decisions.

**Suggested tree** (adapt to existing code, do not blindly overwrite):

```text
Brim-Sentinel/
  frontend/                      # EXISTING Lovable Vite app — preserve
  backend/
    app/
      main.py
      api/                       # versioned REST routers
      core/                      # config, identity, permissions, errors
      db/                        # models, session, migrations, seed
      schemas/                   # typed API DTOs
      services/                  # intake/extract/coding/validation/etc.
      integrations/              # optional LLM provider, fixture fallback
    tests/
    requirements.txt or pyproject.toml
  scripts/                       # import, seed, eval, smoke, demo
  data/                          # optional sanitized fixtures; never secrets
  ARCHITECTURE.md
  FINANCIAL_RULES.md
  ACCEPTANCE_TESTS.md
  IMPLEMENTATION_STATUS.md
  API_CHANGELOG.md
  README.md
  .env.example
```

Use configurable `BRIM_DATA_DIR` for original CSV/JSON/documents, `DATABASE_URL` for SQLite, `AI_ENABLED=false` by default, `AI_MAX_CALLS_PER_CASE=8`, daily/per-run AI budgets, and a fixture replay mode. Never commit API keys, bank account numbers, or private files. Configure CORS for local frontend origin only; provide clear `make dev`/shell scripts or documented two-terminal startup. Health endpoint, consistent JSON error format, pagination and stable IDs are required.

## 4. Canonical state and data model

Implement durable tables for: User, Department, Vendor, VendorBankChange, VerifiedPaymentRoute, Contract, PurchaseOrder, Invoice, InvoiceVersion, InvoiceLine, Document, EmailMessage, CodingSuggestion, ValidationFinding, DuplicateCandidate, ResolutionCase, ResolutionAction, ApprovalPolicy, ApprovalDecision, Payment, CardTransaction, AuditEvent, EvidenceReference, and optional AgentInvestigation/AnomalyResult.

Invoice lifecycle: `RECEIVED → DRAFT → EXTRACTED → CODED → VALIDATED → (ON_HOLD ↔ RESOLUTION) → PENDING_APPROVAL → APPROVED → SCHEDULED → RELEASED → SETTLED`, with REJECTED/CANCELLED/FAILED and revalidation after material changes. Do not use a single mutable status as a substitute for persisted versions, findings, approvals and events. Make transitions explicit, validated and auditable. Use DB transactions for approval/version and release gates.

Validation finding: `PASS | FAIL | UNKNOWN | NOT_APPLICABLE`, severity, typed code, evidence IDs, rationale, next action and blocking flag. UNKNOWN must be visible and fail closed when needed. Evidence references point to source record/document/page/region where available. Resolution cases persist independently of model availability; status transitions and required actions are deterministic.

## 5. Mandatory functional implementation — FR-01 to FR-10

### FR-01 — Intake and classification
Import `emails.json` and all available referenced PDF/PNG attachments, one invoice draft per payable attachment, with source email ID, sender, file hash, metadata and deduplication on retry. Distinguish invoice, credit note, statement, payment inquiry, marketing/non-AP and missing attachment. Multi-attachment EM-029 produces separate drafts. EM-058 produces a missing-document work item, not a payable invoice. EM-056/057/059 are non-payable. Provide upload endpoint for unseen PDF/PNG and batch import command. Ensure malformed documents fail safely and appear in review.

### FR-02 — Bilingual extraction
Text-first PyMuPDF; OCR/vision fallback for scans and French documents. Return structured vendor, invoice number, dates, currency, line items, subtotal, each tax and total, original text and evidence coordinates where possible. Schema-validate; do not invent unreadable fields. Support deterministic cached extraction fixtures if no paid LLM or OCR provider is available; label fixture extraction and provide real pipeline hooks. Show original document and uncertain fields for clerk correction. Do not let extraction guesses become payable without review.

### FR-03 — Learned GL and department coding
Integrate supplied `coding_model.py` if available, preserving its existing behavior and CLI. PO department takes priority, then requester department, otherwise classifier. GL prediction uses text/vendor features, unknown-vendor fallback and similar historical lines. Return confidence, alternatives and three supporting examples. Below 0.70 requires human review. Clerk override requires reason, creates a material version if applicable, and is audited. Train only from approved corrections. Run actual time-holdout evaluation before publishing metrics; do not repeat unverified README numbers as measured results.

### FR-04 — Deterministic validation
Validate vendor status/identity, contract existence/expiry/rates/caps, PO vendor/status/balance, arithmetic, provincial tax, invoice dates, bank change history, currency and invoice-date FX, logistics-specific rules when supported. PO referenced but over remaining balance → finance manager routing. Vendor `requires_po=yes` with missing PO → hard hold P13. Credit notes reduce vendor payable balance and never schedule as payment. Store FX rate/date on invoice version and apply CAD equivalent to thresholds. Each check has typed result and evidence; failed/unknown material checks create/update a case. Never trust matching vendor master bank details when bank-change history says the account was not independently verified.

### FR-05 — Duplicates, including Brim card-paid
Exact and normalized vendor/invoice number; near matches across vendor aliases, amount/currency, date and descriptions; historical paid invoice/payment matches; Brim card transaction descriptor/amount/date candidate matches. Clearly distinguish confirmed duplicate from possible candidate; show underlying records and match rationale. Do not automatically reject legitimate recurring equal-amount invoices. Authorized dismissal requires reason and audit; a dismissal cannot override another independent hard hold.

### FR-06 — Versioned approvals
Load P01–P13 from `approval_policies.csv`/`users.csv` as applicable. Build ordered chain with reasons and merged duplicate steps; enforce department scope, individual limits, delegation, absence/termination escalation, self-approval prohibition, and one person at most one approval step per invoice version. Material edits to amount/vendor/terms/currency/destination/relevant coding invalidate prior approvals and force revalidation. API must deny forged approval requests, not just hide UI buttons.

### FR-07 — Simulated EFT/payment release
Prepare and schedule **SIMULATED** EFT only when latest invoice version has current required approvals, no unresolved hard holds, valid verified route and amount/role permissions. Release is a separate authorized human action with segregation of duties, transactional rechecks and idempotency key; repeated request returns the original result, never a second payment. Track SCHEDULED/RELEASED/SETTLED/FAILED; settlement is explicitly simulated. If no eligible releaser exists, hold and create `NO_ELIGIBLE_RELEASER` case; never bypass or silently stall.

### FR-08 — Append-only audit
Record actor, timestamp, object ID/version, action, previous/new state or hashes, policy decision, evidence IDs, denied actions and agent lookup metadata. Do not offer a normal mutation endpoint for audit rows. Auditor can filter, inspect and export CSV; auditor cannot mutate. Flight Recorder must replay only stored events and open real evidence; no invented intermediate steps or model private reasoning.

### FR-09 — Vendors, onboarding, bank changes
Search vendor master; unknown/pending vendor onboarding states; duplicate vendor identities; bank-change requests and independent trusted-contact callback verification; authorized two-person control for sensitive updates. An AP clerk cannot directly activate a new bank route. Verification requires recorded trusted contact provenance, verifier identity, time, method, notes and evidence; checking a UI box is not verification. Bank details masked in normal UI and agent output. Existing unverified history remains a hard hold even when invoice account matches updated vendor master.

### FR-10 — Customer-friendly Simple Mode and wizard
Use current **light enterprise fintech** look: warm white/light gray background, restrained purple Brim-style accents, readable dark text, subtle borders and status colors. Avoid a charcoal/neon command-center redesign. Preserve current dashboard/sidebar/table as starting point; remove dead-end `Soon` placeholders by implementing useful pages. Primary navigation: Home, Invoices, Approvals, Payments, Vendors; Cases and Audit accessible via secondary menu without hiding AP case access. Dashboard has **Needs your attention**, **Ready for approval**, **Upcoming payments** with backend-derived role-scoped counts, supplier/ID/amount/owner and exactly one primary action per task. No hardcoded fabricated totals. Demo identity picker must say **“Demo identity — not authentication.”**

Invoice detail default: supplier, amount, status, plain-language issue, single primary CTA; document/extracted fields/checks/coding/payment route in digestible panels. Show “Why this matters”, “What happens next”, “See evidence”; advanced policy codes, confidence and IDs behind View details. Risk is **review priority**, not fraud probability. Explicit `Simulated` labels on every payment action.

**Four-step bank-change wizard:**
1. **Review:** current hold, old/new masked last four, history record and evidence.
2. **Verify supplier:** trusted callback to contact already on file, with verifier identity/time/method/evidence; no client-side self-verification or checkbox-based clearance.
3. **Choose payment route:** EFT only after verified bank route; optional simulated Brim virtual card only when independent verified merchant route and all other gates exist. Card history alone never establishes ownership. Finance manager authorizes payment-method change.
4. **Request authorization:** summary, evidence and approver chain; requesting is not approving/releasing. Backend revalidates current version and independent release conditions.

Handle missing trusted contact, unverifiable callback, absent verified card route, changed invoice version, denied role, no eligible releaser and network timeout with clear safe next actions; hold remains until authorized resolution.

## 6. Financial policy matrix — implement exactly, test at API level

| Rule | Requirement |
|---|---|
| P01 | CAD ≤ 10,000: department manager |
| P02 | CAD > 10,000: department manager → finance manager |
| P03 | CAD > 50,000: add controller |
| P04 | CAD > 250,000: add CFO (U001, `controller_admin` with CFO title) |
| P05 | Pending/new vendor: add finance manager (merge if already present) |
| P06 | Legal vendor: add finance manager (merge if already present) |
| P07 | Requester cannot self-approve: escalate to approver's manager |
| P08 | Approver on leave: delegate, record both identities; avoid same person twice |
| P09 | Release ≤ CAD 100,000: finance manager authority, subject to SoD |
| P10 | Release > CAD 100,000: controller_admin authority, subject to SoD |
| P11 | Releaser must not have approved invoice |
| P12 | PO-referenced amount must fit remaining balance; otherwise finance manager routing |
| P13 | Vendor requiring PO without PO: hard hold |

Individual approval limits: department manager CAD 10,000, finance manager CAD 50,000, controller CAD 250,000, CFO CAD 500,000; policy escalation must respect these limits. Preserve documented policy behavior if a dataset rule requires more precise interpretation.

**Critical edge cases:**
- Above CAD 10,000, finance manager U003 is generally in approval chain and **cannot** release. An eligible controller/CFO who did not approve must release if within policy.
- Above CAD 250,000, U002 controller and U001 CFO are both approvers; no remaining eligible releaser → `NO_ELIGIBLE_RELEASER` hold and documented escalation, never bypass.
- Facilities manager U012 on leave, delegate U003; invoice > CAD 10,000 must not let U003 fill two approval steps. Escalate conflicting step to controller and record why.
- CFO is mapped by title to U001; no standalone `cfo` role. Fail closed if missing.
- Duplicate finance manager steps from P02/P05/P06 merge, preserving all triggering rule IDs.
- Terminated requester U015 cannot act; department manager owns rework.
- AI/service identities have zero approve/verify/release/policy-edit permissions.

## 7. Resolution Engine — the differentiator

Each material FAIL/UNKNOWN creates or updates a persistent `ResolutionCase` with invoice/version, findings, evidence, owner, severity, status, ordered **Path to Pay**, human decisions and linked correspondence. States: OPEN → INVESTIGATING → AWAITING_INFORMATION / AWAITING_VERIFICATION / AWAITING_AUTHORIZATION → READY_FOR_REVALIDATION → RESOLVED or REJECTED/CANCELLED. Reopen when material evidence/version changes. A case cannot be resolved because an LLM says so.

Deterministic action templates:
- `BANK_CHANGE_UNVERIFIED`: hold → trusted callback → authorized bank verification → revalidate → approval → independent simulated release.
- `CARD_PAID_DUPLICATE`: hold → inspect card receipt/transaction → authorized evidence-backed determination → revalidate.
- `CONTRACT_RATE_EXCEEDED`: compare contract line/rate → corrected invoice or authorized exception → revalidate.
- `UNKNOWN_VENDOR`: onboarding → independent verification → authorized activation → revalidate.
- `NO_ELIGIBLE_RELEASER`: hold → escalate documented policy gap, **no release shortcut**.

An AI may draft a supplier email/callback script and explain evidence; a human sends communications and authorizes changes. Persist actual human decisions and distinguish PROPOSED from COMPLETED actions.

## 8. Safe, bounded investigation agent (P1 only after core)

Implement optional Claude-backed read-only investigation with deterministic fallback. **No general SQL tool, no arbitrary query, no write tools, no approval/release/bank verification.** Fixed parameterized allowlisted lookups only:
`get_invoice_evidence`, `get_vendor_profile`, `get_bank_changes`, `get_contract_terms`, `find_related_invoices`, `get_card_transactions`, `get_approval_history`.

Enforce validated IDs/case/actor scope, read-only DB access, masked bank fields, maximum 8 calls per case, 3-second lookup timeout, 200-row result cap, per-case/day token and cost budgets, bounded retries, caching by source hash/prompt/model version. Return schema `{summary, evidence, proposed_actions, open_questions, complete}`. A validated application service may persist proposed actions as PROPOSED; the model never writes directly. Reject unsupported numbers/names by checking against cited evidence, otherwise show deterministic template. Treat document text as untrusted data; injection detector is best-effort, but absence of privileged tools is the security boundary. Log lookup name, sanitized args, row count, hash, duration, model/cost/version without exposing secrets or private reasoning. Default AI off and fixture replay on so demo works with zero paid credits.

## 9. Applied ML and anomaly priority (P1, advanced P2)

Coding model is genuine supervised ML; anomaly score is deterministic robust statistics, **not** a learned fraud probability. Implement as-of historical baselines using log positive invoice totals, median, MAD with floor 0.04 and robust z = `0.6745 × (log(amount) − median(log(history))) / max(MAD, 0.04)`. Exclude target invoice and all future history, credit notes and zero/invalid totals. When history is sparse, state insufficient supplier history and optionally identify a category baseline; do not fabricate confidence. Explain unusual amount with computed dollar values and evidence. Risk-sort review queue, but never automatically block or clear a hard hold solely on anomaly score.

**Only after P0/P1 core is proven:** empirical-Bayes supplier/category shrinkage; signals for amount, fuel surcharge, timing, identity/bank and round-number pattern; group correlated signals and compute grouped noisy-OR `1 − Π(1 − p_group)`; document hand-set weights and component breakdown; high ≥0.60, medium ≥0.30, low otherwise. Reviewer decisions logged with reason and actor; refitting from 30+ labeled decisions per signal is P2, versioned and reversible.

Reproduce existing reported fixtures (do not assume they pass): Lattice Ledger 557 ($9,266 vs usual $1,439), Queen Street 002935 ($18,758 fixed rent), Polar Freight 000964 fuel 22%, Cascadia scan_8049, credit note, no-look-ahead bank change. Optional fixed-seed injection test with 200 normal invoices, variants 2×/3×/5× amounts, fuel surcharges, bank swaps, early repeats and due-on-receipt. Report actual per-type synthetic catch rates and false alarms; never call these real fraud recall.

## 10. UI design system, screens and mascot integration

Preserve existing Lovable look and responsive behavior. Favor clean AP productivity software over trading-terminal visuals. Implement:
- Home / AP Inbox: role-scoped task groups, search, filters, sorting, counts and clear next actions.
- Invoice detail: original source viewer, extracted fields and line coding, validation evidence, duplicates, approval chain, case link and simulated payment status.
- Cases: prioritized persistent exceptions, deterministic Path to Pay, human decisions, wizard entry, evidence-linked investigation summary.
- Approvals: current assigned steps, policy reasons, delegate/limit states, approve/reject with backend enforcement.
- Payments: ready/scheduled/held/simulated released/settled, authorized release action, explicit hold reasons and idempotency UX.
- Vendors: searchable records, pending onboarding, trusted contact, bank change verification history and safe authorization flow.
- Audit / Flight Recorder: filterable event timeline with evidence links, actor/time/version, denial events and export.

Reuse existing `frontend/src/assets/mascots/` if present: **Chip the Beaver** (extraction/coding), **Sage the Owl** (validation/investigation), **Atlas the Wolf** (resolution/approval/payment). Small static stage icons only; never imply they independently authorize money. Light/dark accessibility is optional; light is default. Use meaningful loading/error/empty states, keyboard focus and readable status colors. No fabricated savings, fraud detection metrics or autonomous-agent thoughts.

**Graph priority:** the evidence-linked Flight Recorder timeline is required P1; a branching React Flow graph or vendor-invoice-bank relationship graph is **P2 stretch**, not a substitute for the task-first UX. If built, it must distinguish confirmed links from candidate matches and persisted events from proposed paths. Cut it first when schedule is tight.

## 11. API contract — propose, freeze, then generate from FastAPI

Use versioned `/api/v1` routes with typed responses and consistent error shape. Suggested groups (refine against actual repo and PRD):

```text
GET    /health
GET    /api/v1/me                         # selected demo identity, explicit simulation
GET    /api/v1/dashboard                  # scoped counts + task groups
GET    /api/v1/invoices                   # filters/pagination
POST   /api/v1/invoices/import            # idempotent dataset import
POST   /api/v1/invoices/upload            # file upload
GET    /api/v1/invoices/{id}              # current version, source, checks, coding, evidence
PATCH  /api/v1/invoices/{id}/fields       # authorized edit; version increment
POST   /api/v1/invoices/{id}/validate
POST   /api/v1/invoices/{id}/coding/decision
GET    /api/v1/invoices/{id}/duplicates
GET    /api/v1/invoices/{id}/approvals
POST   /api/v1/invoices/{id}/approvals/{step_id}/decision
GET    /api/v1/cases
GET    /api/v1/cases/{id}
POST   /api/v1/cases/{id}/actions/{action_id}/decision
POST   /api/v1/cases/{id}/bank-verification
POST   /api/v1/cases/{id}/authorization-request
GET    /api/v1/vendors
GET    /api/v1/vendors/{id}
POST   /api/v1/vendors/{id}/bank-change-requests
GET    /api/v1/payments
POST   /api/v1/payments/prepare
POST   /api/v1/payments/{id}/release       # idempotency key required
GET    /api/v1/audit/events
GET    /api/v1/audit/export.csv
GET    /api/v1/invoices/{id}/flight-recorder
GET    /openapi.json
```

Implement role/scope checks in backend dependency/service layer for every read and mutation. **Demo actor selection is not production authentication**: use explicit trusted local demo mode only, e.g. validated `X-Demo-User-Id` header while demo mode enabled; reject arbitrary identities when disabled. No frontend-supplied role, approval state, amount, verification status or route is authoritative. Mutations should require expected invoice version/optimistic concurrency token; stale requests return 409 and leave state safe. Use stable pagination and file serving with access checks. Document endpoint examples and errors.

## 12. Real dataset and fixture requirements

Inspect supplied CSV headers and types rather than guessing them. Seed all supported records with foreign-key reconciliation and provenance. Expected synthetic source categories include:
`users.csv`, `departments.csv`, `vendors.csv`, `contracts.csv`, `purchase_orders.csv`, `approval_policies.csv`, `approvals.csv`, `payments.csv`, `invoices.csv`, `invoice_lines.csv`, `gl_accounts.csv`, `tax_codes.csv`, `fx_rates.csv`, `bank_change_history.csv`, `bank_statement.csv`, `card_transactions.csv`, `emails.json`, `incoming_invoices/`.

Important documented fixtures:
- **Cascadia Cartage V004, BC-009**, 2026-10-27 bank change requested by email but `verified_by_callback=no`; invoice **1625** CAD **6,051.23**; vendor master already contains new account ending **9679**. Must hold based on change history, not just account equality.
- **EM-029** has two invoice attachments; **EM-058** missing claimed attachment; EM-056 statement, EM-057 inquiry, EM-059 marketing.
- Unknown vendors **Blue Heron Couriers** and **Zephyr Data Services**.
- Pending vendor **Riverbend Catering V054**.
- Similar vendor identity **Harlow and Stern LLP** versus **Harlow & Stern LLP**.
- French PDFs `laurentianlogist_FA002399.pdf`, `placemontroyalim-inv-053.pdf`; scans `scan_8049.png`, `scan_8749.png`.
- Credit note `fixwellfacilitys_CNFA000413.pdf`, total **−CAD 1,614.21**.
- USD invoices Sparkgrid CRM and Tessera Analytics, converted with invoice-date FX.
- Facilities leave/delegation U012→U003; CFO U001; controller U002; terminated requester U015.

Do not fabricate invoice PDFs, bank callback evidence, verified merchant identities or synthetic model accuracy without labeling. Create explicit **test-only** verification fixtures when necessary; never portray them as verified live bank or merchant data.

## 13. Acceptance test coverage — AT-01 through AT-48

Create `ACCEPTANCE_TESTS.md` mapping **every** ID to one or more executable tests and current outcome. Implement tests in pytest, frontend tests or Playwright as appropriate. The authoritative PRD contains the full wording; this checklist highlights the expected groups:

- **AT-01–07:** French/scanned extraction; missing attachment; unknown supplier; contract/fuel overcharge; wrong provincial tax; reformatted invoice duplicate; Brim card-paid duplicate.
- **AT-08–16:** requester self-approval denied; approver release denied; material edit invalidates approvals; unverified bank hold; verified simulated card-route gates; double release idempotent; auditor trace/export; unknown extraction; unauthorized direct API access denied.
- **AT-17–24:** >10k finance manager release denied/controller permitted; >250k no eligible releaser; Facilities delegated step collision; Legal duplicate finance step merge; missing required PO hold; credit note no payment; invoice-date USD FX; non-payable emails.
- **AT-25–31:** Cascadia investigation cites BC-009; arbitrary SQL/write requests impossible (v1.4 supersedes original SQL parser test); eight-call cap; unsupported number rejected; prompt injection no authority; model offline deterministic case; lookup audit trail.
- **AT-32–39:** Lattice unusual amount, Queen Street fixed rent, credit note excluded, scanned Cascadia signal, no look-ahead, correlated identity signals grouped, deterministic scores, fixed-seed injection test with actual report. Mark P2-dependent advanced scoring tests deferred only when truly unimplemented; do not misreport them as passed.
- **AT-40–48:** role-scoped task dashboard; understandable invoice review; wizard cannot verify from notes alone; authorized callback evidence and revalidation; no invented card route; authorization request ≠ approval; persisted-only Flight Recorder; no privileged agent tools; evidence-backed risk and sparse-history uncertainty.

Add separate adversarial tests for: actor spoofing in non-demo mode, amount threshold boundaries (exactly 10k/50k/100k/250k), concurrent duplicate release, changed bank destination after approval, no eligible approver, unknown FX rate, invoice retry, missing evidence, audit read-only, unauthorized document access, and API timeout with preserved hold.

## 14. Delivery plan — strict 30-hour-equivalent priority budget

Do not spend the hackathon polishing screens while P0 controls are incomplete. Work by gates and verify exit criteria before expanding scope:

| Gate | Target | Exit |
|---|---:|---|
| 0 — Inspect, seed, contract | 3h | Data loads; money, roles, states, OpenAPI and responsibilities frozen |
| 1 — Vertical slice | 9h | One invoice flows intake → extract/fixture → code → validate → approve → simulated release → audit, with critical denials |
| 2 — Required coverage | 9h | FR-01–09 implemented on available data; core policy, batch and negative tests |
| 3 — Customer journey | 4h | FR-10 dashboard, persistent case, bank-change wizard, Flight Recorder |
| 4 — Differentiation | 2h | Robust median/MAD and bounded read-only investigation if gates 1–3 pass |
| 5 — Integration/demo buffer | 3h | Full smoke path, deterministic fallback, documentation, proof screenshots/logs |

These are planning targets, not guarantees. If behind, **cut in order:** animation → React Flow graphs → Z3 → reviewer refit → retro-audit → virtual-card rerouting → advanced anomaly fusion → optional agent UI. **Never cut** hard holds, server-side permissions, versioned approvals, segregation of duties, idempotency, audit or the usable core UI. A working safe vertical slice beats many disconnected demos.

## 15. Engineering quality and operating rules

- Start with repository reconnaissance, then implement. Do not respond with only architecture prose.
- Preserve existing work; prefer incremental modifications and tests. Never rewrite the entire frontend because it is generated code.
- No TODO buttons that pretend to work, no fake API success, no hardcoded dashboard figures when backend exists, no silent mock fallbacks in production paths.
- Every important service returns typed structured results and explicit error states. Monetary, FX, tax and threshold computations must be testable as pure functions where possible.
- Use SQLite transactions and unique constraints for idempotency and invoice/version invariants. Add indices for lookup-heavy columns. Avoid needless distributed infrastructure.
- External AI is optional; use bounded/cached calls and deterministic fixture mode to minimize credits. Never paste the full dataset into a prompt. Model output is untrusted, validated data.
- Distinguish extraction uncertainty, duplicate candidate uncertainty, anomaly review priority and actual hard policy violations.
- Re-run build/tests after each integration; inspect errors rather than guessing. Keep failing tests visible and fix them before expanding scope.
- Record important tradeoffs and unresolved limitations in `IMPLEMENTATION_STATUS.md` and `ARCHITECTURE.md`.
- If source files are missing, make the rest of the app functional with supplied records and clearly labeled synthetic test fixtures; document what remains unverified. Do not fabricate success.
- Do not commit `.env`, secrets, generated model weights containing private data, or confidential full bank details.
- Do not claim an agent executed actions, made callbacks, contacted suppliers, or paid funds unless those actions genuinely happened; all payments are simulations.

## 16. Final demonstration and release checklist

Provide a deterministic local demo script, preferably seeded from the supplied dataset:
1. Open role-scoped Home; show real attention counts and Cascadia bank-change hold.
2. Open Cascadia 1625; display source evidence, bank-change history BC-009 and plain-language reason.
3. Follow four-step wizard; prove unverified checkbox/notes cannot clear hold; show authorized, **test-fixture-backed** independent callback verification only if such evidence is explicitly seeded.
4. Revalidate and route approvals; show self-approval and approver-release denials, with audit events.
5. Where a legitimately eligible independent releaser exists, perform **simulated** EFT release twice with same idempotency key; show one payment and trace. Otherwise demonstrate explicit safe hold and a separate eligible seeded invoice for the full settlement path.
6. Show a Brim card-paid duplicate candidate, missing PO hold, credit note treatment and USD FX.
7. Open Flight Recorder and click evidence; demonstrate only persisted events.
8. Show actual coding evaluation/anomaly results if reproduced; otherwise label unverified and omit performance claims.

**Before finishing, run and report:** backend test command/results, frontend build/test command/results, Playwright smoke command/results, seed/import counts, number of passing acceptance tests, any skipped tests with reason, and current Git commit/branch. Update root README with copy-paste startup commands and demo credentials/identities clearly labeled simulation. Provide a concise final engineering handoff listing what truly works, what is deferred, and how to demo it. Do not say “all done” if a required feature or security test fails.


## 17. End-to-end system design — implement, do not merely diagram

### 17.1 Trust boundaries and dependency direction

Implement this dependency direction and document it in `ARCHITECTURE.md`:

```text
Browser (untrusted)
  React routes → query/mutation hooks → typed API client
                              │ HTTPS/REST (localhost in demo)
                              ▼
FastAPI boundary: identity + authorization + schema + version checks
                              │
              ┌───────────────┼───────────────────────┐
              ▼               ▼                       ▼
       Invoice services   Resolution/policy       Read-only query
       intake/extract     approval/payment        and audit APIs
       coding/validate    verification            for evidence/graph
              │               │                       │
              └───────────────┼───────────────────────┘
                              ▼
                   SQLAlchemy Unit of Work
                     SQLite persistent DB
                              │
              ┌───────────────┴───────────────────────┐
              ▼                                       ▼
       Local deterministic ML                 AI gateway (optional)
       sklearn / anomaly / match             bounded read-only tools
                                              cached + budgeted
```

Only backend application services may transition invoice/payment states. API routers are thin: parse → authorize → call service → serialize. Service methods do not import FastAPI; repositories do not import route handlers. All outbound model calls pass through one gateway. The frontend does not query SQLite, invoke Python directly, or infer permissions from local role labels. Do not introduce a queue, broker, microservices, graph database, or cloud service merely for architectural appearance.

### 17.2 Transaction and concurrency invariants

Define and enforce these invariants with DB constraints, transactions and service-level checks:

- Monetary values are `Decimal` with explicit currency and scale, or integer minor units; `CAD` comparison amount and exact FX source/date are stored on the relevant invoice version. Rounding uses a documented rule at currency boundaries; never binary floats.
- Every invoice has one immutable current version number and zero or more immutable historical snapshots. Findings, coding, approval signatures, payment-route selection and evidence reference that version.
- Every state mutation requires `expected_version` or an equivalent optimistic concurrency token; conflicting changes fail with HTTP 409 and no partial side effects.
- Every approval is unique by `(invoice_id, version, approval_step)` and records the actual individual actor, not just their role. Duplicate required *roles* can be merged, but distinct required steps cannot be satisfied by the same person.
- An invoice version may have at most one successfully released simulated payment. An idempotency key is unique within an actor/operation scope and maps to a persisted result; a replay with different payload returns 409.
- Payment release transaction re-reads the latest version, current hold findings, active vendor route, required approvals and releaser's prior approvals *inside the transaction*. Concurrent requests cannot both succeed.
- Sensitive bank verification and bank-route activation are separate recorded actions with provenance and role checks; no user-supplied `verified=true` is accepted.
- Audit records are written in the same transaction as the business mutation when possible. Failed authorization attempts are logged separately without falsely implying a successful mutation.
- File hashes and external source IDs enforce import idempotency. Repeat imports do not create duplicate invoices or double-post payments.
- `UNKNOWN` never silently becomes `PASS`; unknown evidence that affects a hard gate blocks progress until resolved through an authorized workflow.
- No frontend, LLM, fixture, or background worker can bypass these invariants.

SQLite write contention must be handled explicitly for the demo (transaction discipline, busy timeout and safe retries where appropriate). Tests should simulate duplicate release requests and stale invoice-version edits.

### 17.3 Core application services and responsibilities

Implement named service boundaries (exact filenames are flexible):

| Service | Inputs | Outputs / side effects |
|---|---|---|
| `IntakeService` | email, attachment, uploaded file | classified intake item, file hash, draft or non-payable work item, audit |
| `ExtractionService` | document ID/version | extracted fields, line items, evidence references, uncertainty, review state |
| `CodingService` | invoice lines, PO/requester context | GL and department suggestion, confidence, examples, human override record |
| `ValidationService` | immutable invoice version, master data | deterministic findings with PASS/FAIL/UNKNOWN/N/A, hard-hold flag, citations |
| `DuplicateService` | vendor aliases, invoice and card history | exact/candidate matches with reason and linked record IDs |
| `AnomalyService` | historical as-of records | deterministic priority score, baseline stats, component evidence |
| `ApprovalPolicyService` | amount CAD, vendor, department, requester, policies | ordered chain, merged rule reasons, eligible actors and escalation |
| `ApprovalService` | actor, invoice version, step, decision | approved/rejected decision, updated chain, audit; never payment |
| `VendorVerificationService` | trusted contact, verifier, bank-change evidence | authorized verification record and revalidation request |
| `ResolutionService` | findings, actor, evidence | persistent case, ordered Path to Pay, allowed next actions |
| `PaymentService` | approved version, verified route, actor, idempotency key | prepared/scheduled/released/settled **simulated** payment and audit |
| `InvestigationService` | scoped case ID | bounded evidence retrieval, optional AI proposal, deterministic fallback |
| `AuditService` | event and evidence references | append-only events, role-scoped query/export, Flight Recorder |
| `DashboardQueryService` | current actor/scope | role-scoped counts and actionable task rows |
| `RelationshipQueryService` | invoice/case ID | evidence-backed graph nodes and typed edges; no inferred facts as confirmed |

Service composition is orchestrated through explicit commands. Do not create circular service dependencies or allow AI tool handlers to call mutation services.

### 17.4 Primary happy-path sequence

Implement and test the complete sequence below. Every arrow denotes a persisted, observable transition, not a decorative animation.

```text
Email/upload → classify → payable invoice draft
    → store original document + source/hash
    → text extraction or OCR fallback → field confidence/evidence
    → human correction where uncertain → invoice version
    → GL/department suggestion + reviewer confirmation when needed
    → deterministic validation + duplicates + anomaly priority
       ├─ hard FAIL / material UNKNOWN → hold + ResolutionCase → guided Path to Pay
       └─ no hard hold → compute approval chain
    → eligible human approval(s), bound to invoice version
    → verified destination + all current gates
    → prepare/schedule SIMULATED payment
    → independent authorized human release with idempotency
    → simulated settlement status
    → append-only audit + evidence-linked Flight Recorder
```

No payment proceeds because an AI explanation says it is safe. Anomaly score is advisory only. For any missing prerequisite, expose a specific safe next action and persist the hold.

### 17.5 Failure and recovery sequence

Implement these as explicit outcomes, not uncaught errors: missing attachment → request document; unreadable scan → extraction review; unknown vendor → onboarding hold; missing PO → PO request; contract/tax discrepancy → human correction/authorization; candidate duplicate → review with evidence; unverified bank → verification wizard; absent verified card route → disable alternative; insufficient approval authority → escalation; no eligible releaser → explicit held case; stale invoice version → 409 + refresh; unavailable AI → deterministic investigation; unavailable OCR → pending manual extraction; missing FX → hold; API timeout → preserve prior state and allow safe refresh; failed simulated settlement → visible failure with auditable retry rules. No automatic retry may perform a second release.

## 18. Exact financial workflows and decision algorithms

### 18.1 Invoice intake and classification

1. Parse each email once using its stable source ID; classify the email and *each attachment independently*.
2. Store attachment filename, MIME type, SHA-256, size, origin, email linkage and processing state. Enforce reasonable size/type limits; reject traversal paths and unsafe filenames.
3. Route statements/inquiries/marketing to non-payable inbox categories. Do not generate payable drafts from these.
4. Create one invoice draft per payable attachment; credit notes have separate negative-balance treatment.
5. For absent attachments, create an actionable missing-document item with source email evidence.
6. Store extraction provenance: `pdf_text`, `ocr`, `vision`, `manual`, or `demo_fixture`. Never label fixture output as live OCR.
7. Preserve source text and document page/region when available; extracted values are proposals until validated.
8. On repeat import, compare source ID + attachment hash; return existing records instead of duplicating them.

### 18.2 Extraction, arithmetic and taxes

- Normalize invoice number conservatively; keep raw and canonical values. Keep vendor display name and vendor ID distinct.
- Parse ISO dates with source locale awareness; keep raw date string and normalized date; ambiguous date yields UNKNOWN.
- Parse line quantity, unit price, line total, discount, subtotal, individual tax lines, currency and total; store raw evidence for each field.
- Recompute totals from decimal lines; record the tolerance and currency precision explicitly. Mismatches produce findings, not silent corrections.
- Resolve tax treatment using `tax_codes.csv` and vendor/invoice province data when available; absent jurisdiction evidence is UNKNOWN, not assumed zero tax.
- Store source currency, invoice-date FX rate and CAD equivalent; never use current spot FX for historical invoice approvals.
- If extraction confidence or required field coverage is insufficient, hold for human review. Corrected values create a new version and trigger revalidation.
- French documents must retain accents and original evidence snippets; normalized extraction should support both French and English field names.

### 18.3 Approval routing pseudocode

```text
amount_cad = validated_invoice_version.amount_cad
required = [department_manager(invoice.department)]
if amount_cad > 10000: required += [finance_manager]
if amount_cad > 50000: required += [controller]
if amount_cad > 250000: required += [CFO mapped to U001]
if vendor is pending/new or legal: required += [finance_manager]
if PO is referenced and exceeds remaining balance: required += [finance_manager]
if vendor requires PO and PO missing: HOLD(MISSING_REQUIRED_PO)

merge same required *role step* while retaining every triggering policy ID
for each step in order:
    find active eligible actor with department scope and sufficient individual limit
    if requester is actor: escalate to permitted manager
    if actor absent: resolve permitted delegation and record original/delegate
    if actor already used on another step: escalate to next eligible actor
    if no actor exists: HOLD(NO_ELIGIBLE_APPROVER)
on material invoice edit:
    increment invoice version; invalidate all prior approvals; revalidate
```

Treat the above as an executable decision table; where PRD dataset policy fields are more specific, honor the source policy. Test thresholds at exact boundary and just above boundary values. Do not collapse CFO into an invented standalone role. Do not grant permissions merely because a display title says CFO.

### 18.4 Release routing pseudocode

```text
with database transaction:
    lock/re-read invoice current version and payment attempt
    assert invoice is payable positive amount, not credit note
    assert no blocking FAIL/UNKNOWN findings or unresolved bank hold
    assert all required approval steps valid for current version
    assert active destination independently verified and version-bound
    assert payment amount/currency/route unchanged since approvals
    if amount_cad <= 100000:
        releaser must have finance_manager authority or explicitly permitted
        non-approving higher authority under policy
    else:
        releaser must have controller_admin authority
    assert releaser is active and did not approve this invoice version
    assert releaser is not requester if policy disallows
    assert idempotency key unused or same request payload
    if no eligible releaser: HOLD(NO_ELIGIBLE_RELEASER)
    persist one SIMULATED release + audit event atomically
```

For >250k, preserve the PRD's documented impossible release condition: controller and CFO both approved, so no remaining eligible releaser under the supplied policy. Do **not** solve this by introducing an invented superuser, changing thresholds, or ignoring segregation of duties. Record an escalation/blocked case.

### 18.5 Bank-change wizard backend state machine

Persist a `ResolutionCase` and `VendorBankChange` with states such as `REQUESTED`, `PENDING_INDEPENDENT_VERIFICATION`, `VERIFICATION_RECORDED`, `PENDING_ROUTE_AUTHORIZATION`, `AUTHORIZED`, `REVALIDATION_REQUIRED`, and `CLOSED` where supported by the PRD. Do not conflate *case* status with *bank change* status.

```text
Review issue (read-only)
    → obtain trusted contact from pre-existing vendor record
    → authorized verifier records independent callback provenance + evidence
    → backend checks trusted contact existed before change request
    → backend records verification, audit and bank-change version
    → eligible finance authority approves destination/method change
    → backend revalidates affected invoice version and all hard holds
    → select only eligible EFT or independently verified card route
    → submit approval request (does not approve)
    → human approvals → independent human simulated release
```

A callback note or checked box alone never flips verification status. Missing trusted contact blocks verification. New account already present in vendor master is not proof. Card transaction history is not proof of merchant ownership. A user who submits the authorization request cannot forge the approver or releaser identity. Reopening a case after timeout must show the persisted authoritative state.

### 18.6 Duplicate matching and safe dismissal

Implement staged matching: exact normalized `(vendor_id, invoice_number)`; vendor-alias-aware invoice-number matching; near duplicate with date, amount/currency and text similarity; historical payment overlap; Brim card-paid candidate matching by merchant descriptor, amount and date. Each result must show `match_type`, `candidate_or_confirmed`, component reasons, linked record IDs and source provenance. Candidate scoring must be deterministic. Recurring fixed monthly invoices should not be auto-blocked solely for equal amount. Dismissal is a versioned, actor-authorized, reasoned decision; it cannot erase separate bank/PO/tax holds.

### 18.7 Anomaly calculation specification

For each positive invoice amount, compute log amount, choose supplier history **strictly before the scored invoice's effective date**, exclude credit notes and the target invoice, and calculate robust center and scale using median/MAD. Document MAD scaling and floor to avoid zero dispersion. Return `(baseline_count, median, MAD, deviation, risk_band, evidence)` with explicit `insufficient_history` state. If supplier history is sparse, use an explicitly labeled category baseline only if valid, and avoid unjustified certainty. The P2 shrinkage/noisy-OR implementation must document grouping, weight choice and component contributions; correlated signals must not be counted as independent fraud evidence. Evaluate seeded perturbations with fixed random seed and preserve the actual output report. Never claim a calibrated fraud probability without calibration.

### 18.8 Agent execution boundary and cost budget

Agent can only call validated, parameterized, actor-scoped read tools: `get_invoice_evidence`, `get_vendor_profile`, `get_bank_changes`, `get_contract_terms`, `find_related_invoices`, `get_card_transactions`, `get_approval_history`. Maximum eight tool calls per investigation, with bounded rows, timeout, total token/cost limits and deterministic offline fallback. No SQL tool, no file-writing tool, no verification/approval/release tool. Validate citations against returned evidence IDs and numbers against actual evidence; unsupported claims are rejected or labeled uncertain. Cache by `(case_id, invoice_version, evidence_hash, model_id, prompt_version)`. Record usage, model version, token counts and tool lookup metadata; never expose hidden reasoning or unmasked bank credentials. Run `AI_ENABLED=false` during development and automated tests.

## 19. Full frontend product specification — no dead-end pages

**The existing Lovable dashboard is the design reference.** Do not discard it, change frameworks or replace it with a generic template. Complete its unfinished routes and replace `Soon` badges only when the corresponding screen actually works.

### 19.1 Route and screen contract

| Route / screen | Must render | Required interactions |
|---|---|---|
| Home / AP Inbox | real role-scoped KPIs, attention queue, searchable invoice table, risk and due labels | search, filters, metric-card filtering, row click, one clear next action |
| Invoice detail | document preview, extracted fields, lines/tax, GL suggestion, validation findings, risk, approval status | review/correct, accept/override coding, open evidence, start case/wizard, view journey |
| Cases / Investigations | persistent cases, severity, owner, findings, evidence and Path to Pay | filter, open case, authorized resolution actions, optional AI investigate |
| Bank-change wizard | four steps and progress, masked destinations, trusted contact provenance, route eligibility, authorization summary | back/next, save draft, verify only via authorized backend action, submit authorization |
| Approvals | role-scoped pending queue, step requirements, history and amount | approve/reject with reason, disabled reasons, refresh after conflict |
| Payments | scheduled/on-hold/released/settled simulated payments, verified route, release eligibility | prepare/schedule/release only via authorized API, idempotent retry, inspect detail |
| Vendors / Suppliers | directory, aliases, status, bank-change history, contracts, linked invoices | search, open profile, request onboarding/change, view verification evidence |
| Audit log | chronological events, actor, action, target, version, evidence | filter, inspect event, export authorized CSV |
| Flight Recorder | persisted invoice event timeline and source links | open evidence, distinguish proposed vs completed, show actors/timestamps |
| Analytics | actual seeded-data aggregations and clearly labeled demo charts | date/status filters, drill-down; never invented savings |
| Relationship graph (P2) | evidence-backed invoice/vendor/bank/PO/contract/card/case nodes and typed edges | zoom/pan, click side panel, filters, confirmed vs candidate styling |
| Settings / Demo identity | demo identity and capability explanation | switch seeded demo user, clearly labeled not authentication |

For every screen implement loading, empty, partial-data, forbidden, not-found, server-error and stale-version states. No success toast may appear until the server confirms persistence. No `setTimeout` mock completion or locally toggled approval status. Use semantic buttons and forms, keyboard navigation, focus states, visible error feedback, masked financial details, and responsive layout.

### 19.2 Design tokens and product behavior

Preserve light-first palette: background `#F8F9FC`, white surfaces, primary text `#1C2434`, violet `#6846D6`, lavender `#F1EDFF`; restrained green/amber/red for state. Maintain Lovable spacing/typography wherever already consistent. Primary actions are labeled in business language: **Review invoice**, **Resolve issue**, **Verify supplier**, **Request authorization**, **Approve**, **Release simulated payment**. Technical identifiers and raw confidence/score components go into expandable **See evidence** or **Advanced details** panels. Do not make the graph the home page. Integrate Chip/Sage/Atlas assets as small consistent assistants in extraction/risk/resolution contexts, never as authority-bearing autonomous agents.

### 19.3 Frontend data and state architecture

- Inspect existing router and API service abstractions; preserve conventions. Build one typed client backed by generated OpenAPI or matching DTOs.
- Centralize server state in existing data-fetching library (or TanStack Query if absent); query keys include actor and invoice version. Invalidate only relevant queries after mutations.
- Use URL-based routing for invoice/case IDs, shareable deep links and a not-found screen.
- Forms use schema validation, disabled/pending states and backend error mapping. Never trust client validation alone.
- Maintain wizard draft state locally for navigation convenience, but persist authoritative verification, authorization and case states server-side.
- Use actual returned `allowed_actions`/`blocked_reasons` to render CTAs. The server re-checks all permissions on submit.
- Make table pagination/filtering server-backed when data volume warrants it. Avoid shipping full private vendor records to the browser.
- Evidence panels fetch authorized source records and handle missing/unavailable evidence without inventing content.
- Keep all simulated payment labels visible on table rows, buttons, detail screens and receipts.

### 19.4 Optional graph semantics

Graph API should return `nodes[{id,type,label,status,evidence_refs}]` and `edges[{id,source,target,relation,certainty,evidence_refs}]`. Render only relationships backed by imported data or explicitly marked candidates. Candidate edges must use different stroke/badge than confirmed edges. Selecting an invoice filters to a bounded neighborhood and displays a side panel. Do not infer beneficial ownership or confirmed bank relationships from fuzzy text similarity.

## 20. Concrete API behavior and schema expectations

Keep the endpoint inventory in §11, and add missing endpoints as required for document upload, coding review, bank verification, vendor change, graph and dashboard. Define all request/response models in Pydantic, generate `openapi.json`, and integrate the frontend against it.

Minimum canonical DTO fields:

```text
InvoiceSummary:
  id, invoice_number, vendor_id, vendor_name, version, currency,
  amount_minor, amount_cad_minor, invoice_date, due_date,
  lifecycle_state, risk_band, blocking_findings_count,
  allowed_actions[], blocked_reasons[], source_kind

InvoiceDetail:
  InvoiceSummary + document_refs[], extracted_fields[], line_items[],
  coding_suggestions[], validation_findings[], duplicate_candidates[],
  approval_chain[], resolution_cases[], payment_summary?, evidence_refs[]

ValidationFinding:
  id, invoice_id, version, code, result(PASS|FAIL|UNKNOWN|NOT_APPLICABLE),
  severity, blocking, rationale, evidence_refs[], next_action

ApprovalStep:
  id, step_index, required_role, trigger_policy_ids[], eligible_actor_ids[],
  assigned_actor_id?, delegated_from_id?, status, decided_at?, decision_reason?

ResolutionCase:
  id, invoice_id, invoice_version, finding_ids[], state, owner_id?,
  severity, path_to_pay_steps[], evidence_refs[], allowed_actions[]

Payment:
  id, invoice_id, invoice_version, method, route_id?, currency, amount_minor,
  state, simulation=true, released_by_id?, idempotency_key_hash?,
  created_at, released_at?, settled_at?

AuditEvent:
  id, occurred_at, actor_id, actor_kind, action, object_type, object_id,
  object_version, result, policy_ids[], evidence_refs[], before_hash?, after_hash?

Graph:
  nodes[], edges[], source_invoice_id, as_of_timestamp
```

Error contract:

```json
{
  "error": {
    "code": "INVOICE_VERSION_CONFLICT",
    "message": "This invoice changed. Refresh before continuing.",
    "details": {"expected_version": 2, "current_version": 3},
    "correlation_id": "..."
  }
}
```

HTTP status semantics: `400/422` invalid input; `401` no identity outside trusted demo; `403` forbidden role/scope; `404` unavailable or inaccessible resource; `409` version conflict, idempotency payload mismatch or invalid transition; `422` unmet business prerequisites when not a conflict; `503` unavailable optional AI/OCR dependency with deterministic fallback where possible. Every mutation returns the authoritative new resource version and allowed next actions. Document authorization requirements and sample payloads in `API_CONTRACT.yaml`/OpenAPI.

## 21. Automated validation matrix and implementation order

### 21.1 Test layers

- **Unit:** decimal arithmetic/FX, thresholds, PO remaining balance, tax checks, vendor aliases, duplicate score, median/MAD, deterministic Path to Pay, approval chain merging, delegated step collision.
- **Repository/service integration:** import idempotency, invoice versions, bank-change hold despite matching master, case persistence, audit transactionality, idempotent release, two concurrent releases, forbidden direct API actions, actor spoofing, missing/unknown evidence.
- **API contract:** request/response schemas, allowed actions, pagination, role scope, 403/409 errors, stale version and unauthorized document retrieval.
- **Frontend component:** table filters, plain-language findings, disabled actions, wizard steps, evidence drawer, Flight Recorder event display, payment simulation labels.
- **End-to-end Playwright:** import/review invoice → see hold → open case → attempt invalid verification (denied) → authorized fixture-backed verification → revalidate → approval → separate release → persisted timeline; plus duplicate/card-paid and no-eligible-releaser negative paths.
- **Model evaluation:** genuine time-holdout coding metrics, deterministic anomaly test and fixed-seed synthetic perturbation report. Do not invent accuracy, precision, recall, fraud rates or saved dollars.
- **Security/adversarial:** model prompt injection; unauthorized approval/release; forged role; replay with changed payload; malicious upload filename; excessive document size; secret leakage; privileged tool absence.

### 21.2 Agent execution loop

Repeat this loop until exit criteria or a genuine external blocker:

```text
Inspect actual code → choose highest-priority failing acceptance criterion
→ implement smallest coherent vertical change
→ add/repair focused tests
→ run tests and build
→ inspect failures and fix
→ commit descriptive change
→ push feature branch if authorized
→ update implementation matrix and next task
```

Do not repeatedly ask the owner to choose naming conventions, UI spacing, package versions or routine implementation approaches. Decide and document. If tests cannot run, report exact commands and error messages; do not silently mark them passed. Do not stop after producing scaffolding, architecture docs or TODO lists.

### 21.3 GitHub autonomy with safe boundaries

Where repository credentials and agent execution permissions permit, Claude Code and Codex may create feature branches, commit, push and open PRs autonomously. Use isolated worktrees; never concurrently edit the same checkout. Integrator may merge only after required tests pass and the target branch is up to date. No force push, no destructive reset, no deleting existing user branches, no secrets in commits, and no deployment or external payment action without explicit owner authorization. A prompt cannot override authentication, sandbox prompts or branch protection; report a blocked action rather than falsely claiming a push succeeded.

### 21.4 Final output artifacts

Ensure repository contains:
`ARCHITECTURE.md`, `FINANCIAL_RULES.md`, `ACCEPTANCE_TESTS.md`, `IMPLEMENTATION_STATUS.md`, `API_CHANGELOG.md`, `.env.example`, a usable root `README.md`, runnable seed/import scripts, backend tests, frontend build/tests, Playwright smoke tests and a demo script. Include a Mermaid architecture/sequence diagram and a machine-readable OpenAPI document. If a feature is P2 and not completed, mark it **DEFERRED** with a reason; do not leave a fake working button.

## 22. Non-negotiable completion criteria

Do not declare the project complete merely because the UI looks good or API endpoints return 200. A feature counts as implemented only when its data model, backend behavior, authorization, frontend interaction, failure states, audit implications and automated verification are present. Track each FR and AT with direct links to source/test files and a truthful status. The primary demo must work with AI disabled and must never require actual supplier calls or real money. A complete, safe core workflow outranks optional graph polish.


---

## IMMEDIATE NEXT ACTION — EXECUTE NOW

Inspect the current checkout and the supplied PRD/data; establish the gap map; implement Gate 0 and Gate 1; continue through Gate 5 as time and environment permit. Make routine engineering decisions autonomously. Coordinate Claude Code and Codex only if those agents are actually available, and never assume an external agent has completed work without verifying commits and tests. Keep the product safe, usable and honest above all else.
