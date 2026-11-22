# Brim Sentinel

**An AI-assisted accounts payable command center that detects invoice risks, guides resolution, and simulates safe payments.**

Brim Sentinel was built for the **CodeJam Brim Financial track**. It turns a fragmented accounts payable process—email intake, document extraction, GL coding, validation, approvals, vendor verification, payment, and audit—into one explainable workflow.

> **Design principle:** AI reads and explains. Deterministic rules decide. Humans authorize. Every action leaves an audit trail.

**Payments are simulated.** This is a demonstration using synthetic financial data, not a production payment processor.

## Why Sentinel is different

Most invoice dashboards stop at displaying an extracted invoice or a risk score. Sentinel connects the entire decision: **what looks wrong, what evidence supports that finding, who can resolve it, what must happen before payment, and what actually happened afterward.**

- **Read-only AI investigation agent:** investigates held invoices using constrained evidence lookups and proposes next steps without authority to approve, verify, or release funds.
- **Trained GL coding model:** predicts general-ledger accounts from invoice line descriptions and vendor context, explains suggestions with similar historical entries, and routes uncertain predictions to a human.
- **Historical anomaly detection:** compares invoices with a vendor's prior behavior, combines related risk signals without double-counting them, and separates advisory risk from hard payment-blocking rules.
- **Evidence-first document review:** extracts English and French invoices, including scans, with field provenance and explicit uncertainty rather than inventing unreadable values.
- **End-to-end financial controls:** enforces approval thresholds, segregation of duties, bank-change verification, safe virtual-card rerouting, and idempotent simulated releases.
- **Financial Flight Recorder:** exposes the history of checks, decisions, evidence, and payment events, distinguishing persisted actions from proposed ones.

## Tech stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 19, TypeScript, TanStack Start / Router, Vite | Application and file-based routing |
| UI | Tailwind CSS 4, Radix UI, shadcn-style components, Lucide, Recharts, React Flow | Accessible workflows, charts, and relationship visualizations |
| Client state | TanStack Query | Server-state caching and invalidation |
| Backend | Python, FastAPI, Pydantic | REST API, validation, and workflow orchestration |
| Persistence | SQLite (WAL), SQLAlchemy 2 | Transactional invoice, approval, vendor, payment, and audit records |
| Machine learning | scikit-learn, NumPy | TF-IDF + logistic-regression GL prediction |
| Document processing | PyMuPDF, RapidOCR, ONNX Runtime, Pillow | PDF text extraction and local OCR |
| Matching | RapidFuzz | Similar invoice lines and fuzzy duplicate candidates |
| Generative AI | Anthropic Claude via a backend AI gateway (optional) | Bounded, evidence-grounded investigations |
| Testing | pytest, Vitest, Playwright | Unit, API, integration, and browser workflow coverage |
| Tooling | Bun (frontend), Python virtual environment | Development and reproducible local execution |

## How it works

```text
Email / uploaded invoice
         |
         v
Classify + hash attachment (idempotent intake)
         |
         v
PDF text extraction or local OCR
         |
         v
GL account suggestions + human review for uncertainty
         |
         v
Financial validation + duplicate checks + anomaly signals
         |
         +---- Blocking issue ----> Resolution case
         |                               |
         |                        Evidence-based investigation
         |                        + human verification / correction
         |                               |
         +<------------------------------+
         |
         v
Versioned, role-based approval chain
         |
         v
Prepare -> independently release -> simulate settlement
         |
         v
Audit trail + Financial Flight Recorder
```

The backend is authoritative: the frontend only presents permitted actions, and every mutation is rechecked server-side.

## Inside the AI investigation agent

**Implementation:** `backend/app/services/investigation_agent.py`, `backend/app/services/investigation.py`, and `backend/app/integrations/ai_gateway.py`.

When a rule places an invoice on hold, Sentinel creates a resolution case. Its investigation system first produces a **deterministic, evidence-backed explanation**. When AI is enabled, Claude can investigate further by selecting from **seven fixed read-only tools**:

1. Invoice evidence
2. Vendor profile
3. Bank-change history
4. Contract terms
5. Related invoices
6. Card transactions
7. Approval history

The agent is **not** a free-form database chatbot. It has no SQL tool and no tool that can change an invoice, authorize a vendor, approve an invoice, or release a payment. Lookups are scoped to the relevant case, with an **eight-call per-case lookup budget**.

The agent returns a structured summary, cited evidence references, proposed actions, and unanswered questions. The backend validates the references, checks that numeric claims come from retrieved evidence, and restricts proposals to allowlisted actions. Invalid or unavailable AI output falls back to the deterministic investigation. Investigation calls and results are auditable.

**Why this architecture?** An LLM is useful for synthesizing evidence and explaining unusual situations, but it should never be the source of truth for financial authorization. Sentinel keeps the model advisory and the payment controls deterministic.

AI is **disabled by default**. The application works without an API key; recorded responses can be replayed for an offline demonstration.

## Inside the machine-learning model

**Implementation:** `backend/app/ml/coding_model.py` and `backend/app/services/coding.py`.

### GL account prediction

The GL classifier is a supervised **TF-IDF + multinomial logistic-regression** pipeline built with scikit-learn.

- **Text features:** word unigrams/bigrams and character 3–5-grams from invoice line descriptions.
- **Structured features:** vendor ID, vendor category, default GL account, and destination province, one-hot encoded.
- **Training:** historical invoice lines with known GL labels; vectorizers and encoders are fitted within the training pipeline.
- **Cold start:** a separate text-only model handles suppliers not present in training.
- **Explanations:** RapidFuzz retrieves similar historical invoice lines to support the predicted GL account.
- **Safety gate:** confidence below **0.70** requires human review; predictions for unseen vendors are capped at **0.69**, so they cannot bypass review.
- **Department coding:** derived from purchase-order data and vendor history rather than guessed by the model.

The shipped model artifact has a SHA-256 manifest. Its loader verifies integrity and can deterministically retrain in memory if the artifact is unavailable or incompatible.

### Evaluation

The repository includes a temporal holdout and leave-one-vendor-out evaluation, with reproducible metrics in [the model evaluation report](backend/docs/MODELS_AND_EVALUATION.md).

| Evaluation | Result |
| --- | ---: |
| Temporal holdout: 146 lines / 21 GL classes | **100.0% accuracy** |
| Vendor-default GL baseline on the same holdout | 97.9% |
| Leave-one-vendor-out, text-only model | **81.5% accuracy** |
| Leave-one-vendor-out, RapidFuzz baseline | 69.9% |
| Cold-start coverage at 0.70 confidence | 68.5% |

**Important:** these results come from the supplied **synthetic** dataset. Repeated vendor descriptions make the temporal holdout relatively easy. The cold-start evaluation is a more informative measure of generalization; neither result should be interpreted as real-world production accuracy.

### Anomaly detection

**Implementation:** `backend/app/services/anomaly.py`.

A separate explainable anomaly system compares invoice amounts against earlier supplier history using robust statistics (median and median absolute deviation). It combines amount and identity-related risk signals with a **grouped noisy-OR** approach so correlated indicators, such as a suspicious bank change and a related identity mismatch, are not counted multiple times.

Backtests use only information available **as of each historical invoice date**, preventing future-data leakage. Anomaly scores prioritize review; **hard validation and approval rules**, not the score, determine whether payment is allowed.

## Invoice intelligence and financial controls

**Document extraction:** PyMuPDF reads text-layer PDFs; RapidOCR/ONNX Runtime handles scanned PNGs, JPEGs, and image-only PDFs locally. Parsed fields retain provenance. Low-confidence OCR values remain unknown and require review. English and French invoices are supported.

**Validation and duplicates:** checks include arithmetic, tax by province, FX, PO and contract terms, vendor identity, bank details, split billing, exact/near invoice duplicates, and potential duplicates already paid by Brim card.

**Approvals and payments:** configurable approval policies (P01–P13), version-aware approval chains, delegation, separation of duties, bank-change callback verification, and independently authorized EFT-to-card rerouting. Payments move through simulated preparation, release, and settlement, with idempotency and concurrency safeguards.

**Auditability:** append-only audit protections, hash-chain verification, recorded denied attempts, exportable audit data, and a Financial Flight Recorder showing both completed and proposed steps.

## Run locally

**Prerequisites:** Python 3.12, Bun, and Git. Run the backend and frontend in separate terminals.

### 1. Clone the repository

```bash
git clone https://github.com/rakib-akter/Brim-Sentinel.git
cd Brim-Sentinel
```

### 2. Backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m scripts.seed
uvicorn app.main:app --reload --port 8000
```

The API is available at `http://localhost:8000` and interactive API documentation at `http://localhost:8000/docs`.

### 3. Frontend

In another terminal:

```bash
cd frontend
bun install
VITE_SENTINEL_API_URL=http://localhost:8000 bun run dev --host 127.0.0.1 --port 8080
```

Open `http://localhost:8080`.

The seeded demo includes historical transactions, incoming emails, invoice attachments, vendors, approval policies, and several intentionally suspicious scenarios. Demo roles are selectable in the UI. **Demo identities are not production authentication.**

### 4. Optional Claude investigations

Configure `backend/.env.example` as a reference for the environment variables. For live AI investigations, set `AI_ENABLED=true` and supply your own `ANTHROPIC_API_KEY` in your local environment. **Never commit API keys.** AI is optional; deterministic investigation works without it.

## Demo walkthrough

A good way to explore the application is the **Cascadia Cartage invoice 1625** scenario:

1. Open the invoice inbox and find invoice **1625**.
2. Inspect the source document, extracted values, rule findings, and payment hold.
3. Open the resolution case and review the evidence-grounded investigation.
4. Record an independent supplier callback using a trusted contact and evidence reference.
5. Switch to an authorized finance role to approve the verified bank change.
6. Complete the required invoice approval with an eligible approver.
7. Prepare the simulated payment, release it using an independent authorized actor, and record settlement.
8. Switch to the auditor role and inspect the Financial Flight Recorder and audit export.

Try an unauthorized action along the way: the server should deny it and preserve the financial controls.

For a second distinctive demo, explore the **Paper Trail EFT-to-virtual-card rerouting** workflow documented in [the backend README](backend/README.md).

## Testing and evaluation

```bash
# Backend (from backend/, after installing dependencies)
python -m pytest
python -m scripts.report
python -m scripts.evaluate_anomaly
python -m scripts.evaluate_ocr

# Frontend (from frontend/)
bun run test
bun run build

# Browser end-to-end tests (requires backend Python dependencies)
BRIM_TEST_PYTHON=../backend/.venv/bin/python bun run test:browser
```

For the backend smoke test, start the API on a **fresh seed** and run `python -m scripts.smoke http://127.0.0.1:8000` from `backend/`. Browser tests start their own test services and database.

The backend's [acceptance matrix](backend/docs/ACCEPTANCE_TESTS.md) maps **AT-01 through AT-48** to test cases. The repository's latest documented backend verification reports **103 passing pytest tests (2026-11-21)**. This README does not claim that the latest combined frontend/backend revision has been independently rerun.

## Repository structure

```text
Brim-Sentinel/
├── frontend/                    # React / TanStack Start app
│   ├── src/routes/              # Dashboard, invoices, approvals, vendors, payments, audit
│   ├── src/components/sentinel/ # Domain-specific UI and workflows
│   └── tests/browser/           # Playwright end-to-end scenarios
├── backend/
│   ├── app/api/                 # FastAPI endpoints
│   ├── app/services/            # Intake, validation, policy, payment, investigation
│   ├── app/ml/                  # Trained GL coding model
│   ├── app/integrations/        # Optional AI gateway
│   ├── app/db/                  # SQLAlchemy models and seed logic
│   ├── tests/                   # pytest suite
│   ├── scripts/                 # Seed, smoke, reporting, evaluations
│   └── docs/                    # Acceptance tests, financial rules, model metrics
├── data/brim_ap_dataset/        # Synthetic challenge data and incoming documents
├── ARCHITECTURE.md              # Design and trust boundaries
└── README.md
```

## Limitations and scope

- **Simulation only:** no real funds move and no external payment rails are connected.
- **Demo security model:** identity selection is designed for judging; production deployment requires real authentication, authorization infrastructure, and operational hardening.
- **Synthetic evaluation:** model and OCR results may not generalize to unseen real-world documents or vendors.
- **Database:** SQLite is suitable for this local demo; schema changes currently require a fresh seed rather than automated migrations.
- **Anomaly model:** the implemented robust-history method does not include empirical-Bayes shrinkage or automated reviewer-feedback refitting.

## Further documentation

- [Architecture and trust boundaries](ARCHITECTURE.md)
- [Backend setup and demo identities](backend/README.md)
- [Financial rules](backend/docs/FINANCIAL_RULES.md)
- [Acceptance tests](backend/docs/ACCEPTANCE_TESTS.md)
- [Implementation status](backend/docs/IMPLEMENTATION_STATUS.md)
- [Models and evaluation](backend/docs/MODELS_AND_EVALUATION.md)

---

Built for the **CodeJam Brim Financial track** — making accounts payable safer, more explainable, and easier to operate.
