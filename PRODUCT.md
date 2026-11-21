# Brim Sentinel — Product Requirements Document v1.4

> Converted from the complete 26-page PDF. Original v1.3 baseline and v1.4 binding amendments retained; amendments take precedence.

> Source page boundaries are marked in comments. Aligned PDF tables are preserved as monospaced blocks to avoid changing values.

<!-- Source PDF page 1 -->

BRIM SENTINEL
Product Requirements Document v1.4 | 21 November 2026

Status: Implementation-ready product direction; implementation not yet verified. Tagline: Detect. Resolve. Settle. Explain.

This is the complete PRD package: the original 21-page v1.3 specification is preserved in full, followed by the authoritative v1.4
implementation amendments. Read the original specification for all unchanged requirements. In any conflict, the v1.4 amendment
controls. No existing payment safety invariant is relaxed.

```text
 What changes in v1.4
   Area                           Binding change
```

```text
   Customer UX                    FR-10 Simple Mode, role-specific task dashboard, four-step bank-change wizard, progressive disclosure,
                                  UX acceptance tests AT-40 to AT-48.
```

```text
   Agent safety                   Replace model-generated SQL with fixed, parameterized, allowlisted read-only lookups for MVP. No agent
                                  write tool; proposals returned as data and persisted by a validated application service.
```

```text
   Delivery scope                 Enforce 30-hour stage gates and explicit cuts. Ship core first, one real resolution journey second; advanced
                                  graph and sophisticated scoring remain optional.
```

```text
   Evaluation integrity           Treat all reported anomaly metrics and model results as unverified until reproduced; isolate synthetic
                                  injection results from real-world detection claims.
```

```text
   UX vs graphs                   Customer task view is default; Flight Recorder timeline is secondary; branching graph is stretch only.
```

Reading order and precedence
1. Read this v1.4 change sheet. 2. Read the complete v1.3 baseline (next 21 pages). 3. Read the v1.4 normative amendments
(last pages). References to v1.3 sections, tables and acceptance tests remain valid except where expressly superseded.

Scope freeze: No additional subsystems before acceptance gates pass. The customer experience must be simple even when
the underlying workflow is complex.

BRIM SENTINEL | PRD v1.4 | Implementation amendments                                                                                             1

---

<!-- Source PDF page 2 -->

BRIM SENTINEL
Product Requirements Document (PRD) — Canonical
Hackathon Specification

Version: 1.3 | Date: 21 November 2026 | Status: Approved product direction; implementation
pending
Changes in 1.3: ML approach and robust anomaly engine (§5B), including the injection test and
reviewer feedback loop; AT-32 to AT-39. See §17.
Changes in 1.2: investigation agent (agentic loop with read-only tools) and the safety design
around it (§5A); AT-25 to AT-31. See §17.
Changes in 1.1: approval and release matrix from the dataset with five edge-case fixes (§4A);
dataset-linked acceptance fixtures (§10.1); PO-required, credit-note, USD and terminated-requester
rules; rate limiting and AI cost controls; verification items updated (§15). See §17.
Customer: Harborline Logistics Inc. (synthetic) | Context: CodeJam 2026, Brim Financial Track
Builder: Solo developer using Claude Code and Codex, with human review and integration.

Detect. Resolve. Settle. Explain.
Product promise: Brim Sentinel does not just detect invoice and payment problems. It
gathers evidence, proposes a safe path to resolution, coordinates human decisions, and helps
suppliers get paid through controlled, auditable workflows.

1. Executive summary

Brim Sentinel is a web-based accounts payable (AP) automation and payment-control platform for
a business-card provider. It unifies invoice intake, bilingual document extraction, learned
accounting-code suggestions, vendor/contract/PO/tax checks, duplicate detection across AP and
Brim card transactions, role-based approvals, simulated payment execution, vendor controls, and
audit trails.

The differentiator is the Resolution Engine: a failed check creates a persistent, evidence-
linked case with a concrete Path to Pay. Sentinel can gather records, prepare a supplier
clarification, guide a trusted callback, route authorization, and revalidate the current invoice
version. It must never autonomously approve, change bank details, authorize a new payment
route, or release funds.

A Financial Flight Recorder turns actual workflow/audit events into a replayable visual
explanation. Chip (extraction/coding), Sage (verification/investigation), and Atlas
(routing/resolution) are small visual identities for processing stages, not autonomous
payment agents.

---

<!-- Source PDF page 3 -->

Positioning

Problem: Businesses process card spend and supplier invoices in disconnected systems;
errors and fraud are caught too late, and resolving exceptions is slow.
Target user: Harborline’s AP clerk, finance manager, department approver, controller,
requester, and auditor.
Why Brim: Cross-check supplier invoices against Brim card transactions and optionally
propose a simulated single-use virtual-card payment through a separately verified merchant
route.
Non-goal: A real-money payment processor, autonomous finance approver, general-
purpose accounting ERP, or real cross-customer fraud network.

2. Success criteria and judging alignment

The official challenge weights required features 40%, technical depth 25%, UI 20%, bonus
15%. Judges test required behavior on an unseen invoice batch. Therefore:

1. Gate A: All nine required features demonstrably work end to end.
2. Gate B: Security invariants and hard holds cannot be bypassed through direct API requests.
3. Gate C: At least one suspicious invoice proceeds through Detect → Resolve → Settle →
Explain, with real stored evidence and events.
4. Gate D: The developer can explain every algorithm, data source, fallback, and design
tradeoff.
5. Gate E: Demo is reproducible without live external payment services; LLM outputs can be
replayed from recorded fixtures.

Measured metrics (do not invent results): incoming-batch processing success, extraction field
accuracy on a labeled subset, GL/department accuracy on a time holdout, duplicate
precision/recall on labeled cases, policy/authorization test pass rate, and demo completion time.
Separate confirmed duplicate payments, potential exposure, avoided simulated losses, and missed
discounts; never sum them as one “savings” figure.

3. Users and permissions

```text
Role                              Can                                  Cannot
```

```text
Employee/requester                Submit invoices, see own             Approve/pay; access other
                                  submissions                          departments’ invoices
```

```text
AP clerk                          Ingest, correct extraction/coding,   Approve invoices or release
                                  investigate, prepare payments        payments
```

```text
Department approver               Approve eligible department          Release payments; edit bank
                                  invoices within policy, delegate     details
                                  while away
```

---

<!-- Source PDF page 4 -->

```text
 Role                                 Can                                    Cannot
```

```text
 Finance manager                      Higher-level approvals, authorize      Release any invoice they approved
                                      vendor/payment-route changes,          (in practice they approve every
                                      release within CAD 100,000 cap         invoice over CAD 10,000, so they
                                                                             mostly release invoices up to CAD
                                                                             10,000; see §4A)
```

```text
 Controller/admin                     Administer policies/users, view all,   Bypass segregation of duties
                                      release according to controls
```

```text
 CFO (role controller_admin , title   Fill the cfo approval step (P04);      Release an invoice they approved
 “Chief Financial Officer”, U001)     release as controller_admin
```

```text
 Auditor                              Read all, export audit records         Mutate records
```

Server-side invariants: - Requester cannot approve own invoice, regardless of nominal role;
reroute/escalate according to policy. - No user who approved an invoice may release its payment. -
Delegated approval records both acting and delegating identities. - Terminated/on-leave approvers
are handled by authorized delegation/escalation. - One person satisfies at most one approval
step per invoice version, including when acting as a delegate (§4A, edge case 3). - Invoices
whose requester is terminated (e.g. U015) remain valid but are owned by the requester’s
department manager for questions and rework; the terminated user cannot act. - AI/service
accounts cannot approve, release, edit vendor bank details, change policies, or mark callback
verification complete. - UI visibility is not authorization. Every mutating endpoint checks
authenticated/selected actor, role, department scope, limits, invoice state, and invoice version. -
For hackathon demo, a demo identity picker is acceptable only as a clearly labeled simulation;
never claim it is production authentication.

4. Functional requirements — nine mandatory features

FR-01 — Intake

Inputs: AP inbox emails.json , uploaded PDFs/PNG images and attached metadata.
Behavior: Classify invoice/credit note/statement/non-AP; create one draft per invoice attachment;
associate source email, sender and attachment hash; flag missing attachment; avoid duplicate
import on retry.
Acceptance: A multi-attachment email creates separate drafts; an unrelated email is not payable;
missing attachments become review items.
Dataset reality: 59 emails and 56 files; every file belongs to exactly one email. EM-029 has two
attachments. Four emails have none: EM-058 claims an invoice is attached (missing-invoice item),
EM-057 is a payment inquiry, EM-056 is a statement of account, EM-059 is marketing (non-AP).

FR-02 — Bilingual extraction

Inputs: English/French text PDFs and scans.
Behavior: PyMuPDF text-first; vision/OCR fallback; structured schema for vendor, invoice number,
dates, currency, line descriptions/amounts, subtotal, each tax and total; preserve original text and
page/region evidence when obtainable. Reject malformed/uncertain values for review.

---

<!-- Source PDF page 5 -->

Acceptance: French invoice extracts tax separately; scanned input works; ambiguous vendor or
unreadable totals are flagged rather than guessed; original PDF remains accessible.

FR-03 — Smart coding

Inputs: Invoice lines, vendor master, historical coding, PO/requester if available.
Behavior: Reuse supplied coding_model.py : department from PO or requester first, else classifier;
GL suggestion from text/vendor features; return confidence, alternatives and three similar
historical lines. Below 0.70 confidence requires human review. Clerk may override with reason; log
corrections; retrain only on approved corrections.
Acceptance: Each line shows GL and department suggestion, explanation and accept/change
action. Reproduce reported holdout metrics before pitching them. Historical results reported in
README are not yet independently verified. When pitching, lead with the hard numbers (85.9%
GL on unseen suppliers; 91.8% department), not the 100% overall GL figure, which mostly reflects
one GL per supplier (see §5B).

FR-04 — Validation and matching

Checks: Vendor status/identity, contract existence/expiry/rates/caps, PO amount/status/vendor,
invoice math, line totals, tax by delivery province, currency and applicable stored FX rate,
suspicious dates, changed bank details, and applicable configurable logistics rules.
PO rules from policy: P12, an invoice referencing a PO must be within the PO’s remaining
balance, otherwise routed to the finance manager; P13, a vendor with requires_po = yes and no
PO number is held.
Credit notes: a negative-total document (e.g. CN- prefix) is classified as a credit note, linked to
the original invoice where referenced, and reduces the amount payable to that vendor; it is never
scheduled as a payment.
Currency: USD invoices are converted with fx_rates.csv at the invoice date; the rate and date
are stored on the invoice version and used for thresholds and limits in CAD.
Result schema: PASS | FAIL | UNKNOWN | NOT_APPLICABLE , severity, code, evidence IDs, rationale,
next action. Unknown evidence must not be silently treated as pass.
Acceptance: Contract overcharge, invalid tax, bad totals, inactive vendor and bank mismatch
each produce evidence-backed findings. Hard holds block payment.

FR-05 — Duplicate detection

Checks: Exact vendor+normalized invoice number; reformatted numbers; near matches on
vendor, amount/currency, dates and descriptions; duplicate vendor identities; card-paid invoice
matches against Brim card transactions and historical payment records.
Behavior: Distinguish confirmed duplicate from candidate; show match strength and underlying
records; permit authorized false-positive dismissal with reason, not automatic payment bypass.
Acceptance: Exact, near, reformatted and card-paid duplicates are detected on seeded fixtures;
legitimate same-amount recurring invoices are not automatically rejected.

FR-06 — Approvals

Inputs: approval_policies.csv , amount in CAD, department, vendor status, user limits, invoice
flags.

---

<!-- Source PDF page 6 -->

Behavior: Build ordered approval chain; support editable policy thresholds, delegation,
absence/termination escalation, rejection and rework. Approvals bind to a material invoice
version (amount, vendor, terms, currency, destination, relevant coding); changes invalidate
approvals and require revalidation.
Acceptance: Correct route by amount; self-approval denied through API; delegates identified;
edited amount invalidates prior approval. The chain builder implements the full matrix and the five
edge-case rules in §4A.

FR-07 — Payments

Behavior: Prepare/schedule simulated EFT; require current approvals, zero unresolved hard holds,
valid route, role limit and separation of duties; release via independent authorized user; track
scheduled/released/settled/failed statuses; idempotent release key prevents duplicate execution.
Releaser selection: eligible releasers are users with release authority for the amount (P09/P10)
who are not in the invoice’s approval chain (P11). If no eligible releaser exists, the payment stays
held with finding NO_ELIGIBLE_RELEASER , is escalated to the controller/CFO for a documented
decision, and the event is logged (§4A, edge case 2).
Acceptance: Finance manager cannot release above CAD 100,000; approving user cannot
release; repeated release request creates no second payment; settlement is explicitly simulated;
an invoice with no eligible releaser is held, not silently released or stuck.

FR-08 — Audit

Behavior: Append-only application events with actor, timestamp, object/version, action, old/new
state or hash, evidence references and policy result; trace payment → invoice → coding → checks →
approvals → release. Export CSV. Optionally hash-chain events; label it tamper-evident, not
immutable without an external trust anchor.
Acceptance: Auditor can reconstruct why a payment was released; denied authorization attempts
are logged; auditor cannot edit.

FR-09 — Vendor management

Behavior: Search vendor master, onboard unknown vendors through pending/approved/active
states, hold unapproved vendors, show duplicate identity warnings, record bank-change requests
and trusted independent verification, enforce authorized two-person control for sensitive changes.
Acceptance: Unknown vendor is held; unverified bank change blocks payment; a clerk cannot
directly activate new bank instructions.

4A. Approval and release matrix (from approval_policies.csv and
users.csv )

The chain builder loads these rules from the dataset; nothing below is hardcoded except the edge-
case logic.

---

<!-- Source PDF page 7 -->

```text
Rule                      Condition                   Required                    Implementation note
```

```text
P01                       Total ≤ CAD 10,000          dept_manager                Manager of the
                                                                                  requesting department
```

```text
P02                       Total > CAD 10,000          dept_manager →              Finance manager = U003
                                                      finance_manager
```

```text
P03                       Total > CAD 50,000          … → controller_admin        Controller = U002
```

```text
P04                       Total > CAD 250,000         … → cfo                     CFO = U001 (role
                                                                                  controller_admin ;
                                                                                  matched by title)
```

```text
P05                       Vendor pending_review or    + finance_manager           Merged if already in chain
                          new
```

```text
P06                       Vendor category Legal       + finance_manager           Merged if already in chain
```

```text
P07                       Requester is the approver   approver’s manager          Escalate; never self-
                                                                                  approve
```

```text
P08                       Approver on leave           delegate_user_id            Record acting and
                                                                                  delegating identity
```

```text
P09                       Payment ≤ CAD 100,000       finance_manager             Clerks prepare only
                                                      releases
```

```text
P10                       Payment > CAD 100,000       controller_admin releases   U001 or U002
```

```text
P11                       Always                      releaser ≠ any approver     Separation of duties
```

```text
P12                       Invoice references a PO     total within PO remaining   Over-balance → finance
                                                      balance                     manager
```

```text
P13                       Vendor requires a PO        PO number present           Missing PO → hold
```

User limits: department approvers CAD 10,000; finance manager CAD 50,000; controller CAD
250,000; CFO CAD 500,000. An approver may act only within their own limit; the policy chain adds
higher steps above it.

Edge cases the matrix creates (must be implemented and tested)

1. Finance manager release is the exception, not the rule. P02 puts U003 in every chain
above CAD 10,000 and P11 bars approvers from releasing. Release for those invoices
therefore falls to the controller or CFO, whichever did not approve. The UI and demo must
reflect this.
2. No eligible releaser above CAD 250,000. P04’s chain includes both controller_admin
users (U002 and U001), so P11 leaves nobody who may release. Outcome: hold with
NO_ELIGIBLE_RELEASER , open a resolution case, escalate for a documented controller/CFO
decision. Never release and never fail silently.
3. One person, two steps. U012 (Facilities Manager) is on leave with delegate U003, who is
also the finance manager. A Facilities invoice over CAD 10,000 would ask U003 to approve
twice. Rule: one person satisfies at most one step per invoice version; when the delegate

---

<!-- Source PDF page 8 -->

already holds a later step, the duplicate step escalates to the next level (controller), and the
reason is recorded.
4. CFO step mapping. There is no cfo role in users.csv ; the step maps to the
controller_admin user titled Chief Financial Officer (U001). Fail closed if no such user exists.
5. Duplicate steps merge. P05 and P06 may add the finance manager when P02 already
includes them; the chain lists each required person once, in order, with every rule that
required them shown as the reason.

Additional dataset conditions: U012 is on leave since 2026-10-20 (delegate U003); U015 is
terminated since 2026-09-15 (see invariants in §3).

5. Signature differentiation — Resolution Engine

Problem: A warning alone leaves AP staff to determine the next step.
Solution: Every material failed/unknown check creates or updates a persistent Resolution Case.

Case fields: case ID, invoice ID/version, finding IDs, risk severity, evidence IDs, owner/role, status,
ordered Path-to-Pay actions, human decisions, timestamps, linked correspondence and closure
outcome.

States: OPEN → INVESTIGATING → AWAITING_INFORMATION | AWAITING_VERIFICATION |
AWAITING_AUTHORIZATION → READY_FOR_REVALIDATION → RESOLVED or REJECTED/CANCELLED . Reopened if
new material evidence arrives. Never mark RESOLVED just because an LLM says so.

Path-to-Pay generator: Deterministic mapping from finding codes and policy to required actions,
with optional LLM wording for plain-language explanation. Examples: - BANK_CHANGE_UNVERIFIED →
hold → trusted callback → authorized bank/route verification → invoice revalidation → approvals →
release. - CARD_PAID_DUPLICATE → hold → inspect card transaction/receipt → confirm duplicate or
record evidence-backed exception → revalidate. - CONTRACT_RATE_EXCEEDED → compare contract and
billed line → request corrected invoice or approved exception → revalidate. - UNKNOWN_VENDOR →
vendor onboarding → verification → approval → revalidate.

Human-in-the-loop: Sentinel may draft emails/callback scripts, collect records, suggest
corrections and queue requests; humans send external communications and authorize
consequential changes.

Definition of “AI helps solve”: It reduces the investigation workload and carries a case toward
an authorized outcome; it does not bypass financial policy or claim autonomous resolution when a
human action is pending.

5A. Investigation agent (agentic loop) and the safety around it

What it does: when a Resolution Case opens for a FAIL or UNKNOWN finding, Claude runs a
bounded loop: it chooses read-only lookups, reads the results, decides what to check next, and
stops with a structured, cited summary. The same loop, with the same limits, powers Ask Sentinel
(plain-language questions about spend and history; P2 stretch).

---

<!-- Source PDF page 9 -->

What it never does: raise or clear a hold, change any record, approve, verify a bank change,
send a message, or release money. Findings come from deterministic rules (§4); the agent
investigates and explains them.

Tools

```text
Tool                                   Returns                            Notes
```

```text
 get_invoice_evidence(invoice_id)      Fields, source regions, findings   Current version only
```

```text
 get_vendor_profile(vendor_id)         Vendor record, status, usual       Bank numbers masked to last 4
                                       amounts, contacts on file
```

```text
 get_bank_changes(vendor_id)           Bank change history                From bank_change_history
```

```text
 get_contract_terms(vendor_id)         Contracts, caps, dates
```

```text
find_related_invoices(vendor_id,       Similar invoices and payments      Includes paid history
amount, dates)
```

```text
get_card_transactions(vendor_id,       Matching Brim card charges         Descriptor matches are
dates)                                                                    candidates
```

```text
 run_sql_readonly(query)               Up to 200 rows                     SELECT only, on curated read-
                                                                          only views; see limits
```

```text
propose_resolution(case_id,            A draft marked PROPOSED            Only write the agent has; a
actions, evidence_ids)                                                    person accepts or edits
```

Limits (enforced by code, not by the prompt)

Read-only by construction: a separate database connection with read-only permissions
on curated views ( v_invoices , v_invoice_lines , v_vendors_masked , v_bank_changes ,
v_contracts , v_purchase_orders , v_payments , v_card_transactions , v_approvals ). Queries are
parsed; anything but a single SELECT is rejected.
Bounded: at most 8 tool calls per case, 3-second query timeout, 200-row cap, per-case
token and cost cap, and a per-day budget (§8). When a limit is hit, the agent stops and
returns what it has, marked incomplete.
Least data: bank accounts masked to last 4; no fields the case does not need.
Untrusted input stays data: invoice text, email bodies and tool results are passed in
labelled data blocks and never treated as instructions. The tool set cannot be changed by
anything the agent reads. A prompt-injection pattern in a document raises a finding (§6).
Cited or rejected: the final output is schema-validated: {summary, evidence: [ids],
proposed_actions, open_questions, complete: bool} . Every number, date and name in the
summary must appear in a cited tool result; the fact check (number guard) rejects anything
else, and the case falls back to a template explanation built from the rule results.
Fail safe: if the model is unavailable, slow or rejected, the case still opens with the rule
findings and the deterministic Path to Pay. The hold never depends on the agent.

---

<!-- Source PDF page 10 -->

The visible trail

Each tool call is stored as an audit event: tool name, arguments, row count, result hash, duration,
cost, model and prompt version. The Flight Recorder shows these as “Sentinel looked up …” steps,
and the case lists the evidence each sentence relies on. The trail shows what the agent did and
found, which a reviewer can check, not the model’s private reasoning. Recorded fixtures make
every investigation replayable for tests and the demo.

What sets Sentinel apart: safety around the agent

Agentic investigation over data is a known pattern (it won a previous Brim challenge for spend
analytics). Sentinel’s difference is that its agent sits in front of money moving, so the system
around it is built so that no AI output can move money or remove a control:

1. Zero authority. The agent uses the same server API and role checks as people, under a role
that can only read and propose. There is no tool that approves, verifies or releases.
2. Rules decide, the agent explains. Holds come from deterministic checks; the agent
cannot raise, clear or soften one.
3. Cited or it doesn’t ship. Unsupported numbers or names are rejected before a person
sees them.
4. Every lookup is recorded and replayable in the Flight Recorder, alongside every human
decision.
5. Bounded and least-privilege: read-only views, masked bank data, call, row, time and cost
caps.
6. Fail-safe: with the AI off or wrong, payments stay held and the Path to Pay still works.
7. Money gates are deterministic and versioned: approvals bound to the invoice version,
verified destinations, separation of duties, idempotent release (§4A, §9).
8. Tested adversarially, live: injection in an invoice, write attempts, uncited claims and API
bypasses are acceptance tests (AT-25 to AT-31).

5B. ML approach and robust anomaly engine

Position: applied ML, sized to the data

Sentinel is an applied-ML system, not an ML research project, and it is pitched that way. The
dataset has 426 invoices and 809 lines. That is too small for deep learning and too small to learn
fraud from labels (there are almost none). So every model is the simplest one that works,
measured honestly, and anything it is unsure about goes to a person.

```text
                                                                      Why this and not something
 Component                        Method
                                                                      bigger
```

```text
 Extraction                       Claude (Sonnet 5.5) + validation    Unstructured, bilingual documents;
                                  rules                               output is checked by code before
                                                                      use
```

```text
 Smart coding (FR-03)             TF-IDF + logistic regression, kNN   Fits 809 lines; trains in seconds;
                                  blend for unseen suppliers          explainable by similar past lines
```

---

<!-- Source PDF page 11 -->

```text
                                                                        Why this and not something
 Component                          Method
                                                                        bigger
```

```text
 Anomaly engine                     Median + MAD, empirical-Bayes       Deterministic; no labels needed;
                                    shrinkage, grouped noisy-OR         every number recomputable
```

```text
 Rules (duplicates, tax, contract   Plain code                          Financial policy must be exact, not
 caps, approvals, bank changes)                                         probabilistic
```

Not used, deliberately: neural networks, fine-tuned LLMs, graph neural networks on supplier
links. None can be justified on this data or explained line by line in Q&A.

Anomaly engine ( anomaly.py )

Pure, deterministic statistics. No AI inside, no randomness: the same data always gives the same
score. Dollar figures are computed by code, never by the model. The AI only rewords each
finding’s fact sentence, and the fact check from §5A rejects any number that does not match.

1. Robust baselines. For each supplier: median and MAD (median absolute deviation) of log
invoice totals. Robust z = 0.6745 × (log amount − median) / MAD. One past outlier or fraud
cannot drag the baseline toward itself. The log scale makes 2× mean the same at $500 and
at $50k. MAD floor of 0.04 (about 4%) stops fixed-fee suppliers producing infinite scores.
2. Empirical-Bayes shrinkage. Suppliers with little history borrow from their category: weight
on own history w = n / (n + σ²within / τ²between). σ²within is how noisy this supplier is;
τ²between is how different suppliers in the category are from each other. Both are estimated
from the data, so a consistent supplier (fixed rent) trusts its own history after a few invoices
and a noisy one needs more. A supplier’s own spread is used only after 5 invoices; before
that, the category’s typical spread (three similar bills look “perfectly consistent” and give
false alarms).
3. Signals, each with a strength p between 0 and 1:

```text
 Group                                               Signals
```

```text
 amount                                              amount outlier vs shrunk baseline (unusually small
                                                     bills count at 35%)
```

```text
 pricing                                             fuel surcharge % vs this supplier’s own history
```

```text
 timing                                              due on receipt or terms much shorter than usual;
                                                     invoice arriving far sooner than the supplier’s usual
                                                     billing gap
```

```text
 identity                                            unknown supplier; supplier with no history; remit-to
                                                     account differs from vendor master; unverified bank
                                                     change from 60 days before the invoice onward
                                                     (including after it: an unpaid invoice would go to the
                                                     new account)
```

```text
 pattern                                             round total from a supplier that rarely bills round
                                                     amounts
```

---

<!-- Source PDF page 12 -->

4. Grouped noisy-OR. Keep the strongest signal in each group, then risk = 1 − Π(1 −
p_group). Related signals (lookalike name and new bank account) are not independent;
counting both would overstate risk.
5. As-of date. Each check uses only data known at that moment, so backtests cannot peek at
the future.
6. Bands: high ≥ 0.60, medium ≥ 0.30, low below. Credit notes are not scored on amount; they
are matched to their original invoice by a rule.

The score ranks and explains; it never blocks a payment. Hard blockers (unverified bank
change, duplicate, PO missing, approval limits) remain rules. A high score opens a case as a
reviewable exception, never an automatic reject. It sorts the review queue (“most unusual first”)
and gives each finding a “why this is unusual” line with real figures. Every score is stored with its
inputs and method version in the Flight Recorder so an auditor can recompute it.

Measured on the dataset (run during review): - Incoming batch, top of queue: Lattice Ledger
557 at $9,266.00, 6.4× its usual $1,439 (normal range $1,386–$1,492 over 8 invoices), found by
no rule; Cascadia 1625 and the scanned Cascadia 1624 (BC-009); Blue Heron and Zephyr
(unknown); Polar Freight 000964 fuel surcharge 22.00% vs usual 9.84%; four suppliers re-billing
within 1–7 days. - Correctly not flagged: Queen Street fixed rent ($18,758 every month), credit
notes, the French invoices. - Backtest over 426 historical invoices with no look-ahead: 2 high, 71
medium (about 50 are each supplier’s first invoice), 353 low. - Known limit: the 12 historically
rejected invoices are mostly duplicates (identical amounts from V019 and V049). The rules catch
those, not this engine. The engine adds to the rules; it does not replace them.

Injection test (measured catch rate) — P1

Fraud labels don’t exist, so recall is measured by planting known anomalies into a copy of history
and checking whether the engine finds them.

Method: sample 200 normal historical invoices (a fixed random seed, so results are
reproducible). For each, create one variant per anomaly type and score it with the as-of date
set to its invoice date.
Anomaly types: amount inflated 2×, 3× and 5×; fuel surcharge raised 5 and 10 points;
remit-to account swapped; unverified bank change inserted 0–30 days before the invoice;
repeat invoice 1–5 days after the previous one; due-on-receipt terms.
Report: catch rate per type at the medium and high bands; false-alarm rate on the
untouched originals; a small table and one chart for the pitch (“catches N of 10 amount
anomalies at a 1.5% false-alarm rate”).
Use the results honestly: publish weak spots (for example, 2× inflation on a naturally
variable supplier) rather than tuning until the numbers look perfect. Signal strengths may be
adjusted once using these results; record the before and after.

Reviewer feedback loop — logging P1, refit P2

Every reviewer action on a finding is logged: accepted (real problem), dismissed (normal),
with reason and user, in the Flight Recorder.
Once enough decisions exist (target: 30+ per signal type), refit the signal strengths with a
logistic regression on those outcomes, replacing the hand-set starting values. Refits are

---

<!-- Source PDF page 13 -->

versioned, reviewed by a person, and can be rolled back; the old and new score for the same
invoice are both shown.
Demo: show the decision log and explain the refit. It does not need to have run.
The system improves from human review without the AI deciding anything on its own.

Q&A answers this section prepares

“100% GL accuracy looks too easy.” It is: most suppliers map to one GL. The honest
numbers are 85.9% on unseen suppliers and 91.8% on departments, against a vendor-
default baseline.
“Your anomaly weights are made up.” They are hand-set starting values because there
are no fraud labels. They are written down, tested by injection, and refit from reviewer
decisions.
“How do you know it catches anything?” The injection test: measured catch rate per
anomaly type and false-alarm rate, reproducible with a fixed seed.
“Why not deep learning?” 426 invoices. The simplest model that works, measured
honestly, with uncertain cases sent to a person.

6. Brim-specific payment intelligence

## 6.1 Card-paid duplicate reconciliation — P0

Use Brim card transactions to detect supplier invoices that may already have been paid by card.
Normalize merchant descriptors and compare vendor aliases, amounts, dates, currency and
available references. Display candidate matches with evidence and explicit uncertainty.

## 6.2 Verified virtual-card rerouting — P1, simulated

When EFT bank details are unverified, never send money to the changed account. Sentinel
may suggest a simulated single-use Brim virtual-card alternative only if: 1. Current invoice version
has all required approvals. 2. Vendor card acceptance is confirmed. 3. A separate verified
payment-route registry identifies the merchant destination and its verification
provenance/recency. 4. Recent successful card history supports the route but is not sole proof. 5.
Trusted callback/independent verification is recorded. 6. Finance manager authorizes the change of
method. 7. An independent release user passes final checks.

Otherwise remain ON_HOLD . Do not infer a merchant account ID from a text descriptor or assert that
the supplied dataset can establish a live merchant’s current ownership. Demonstrate using clearly
labeled synthetic verified-route fixtures and simulated card issuance/payment.

7. Financial Flight Recorder and visual design

Primary experience: Enterprise-grade dashboard and three-column invoice review: source
document, extracted/coded details, checks and Path to Pay. Other screens: inbox, approvals,
payments, vendors, cases, audit, optional spend overview.

---

<!-- Source PDF page 14 -->

Flight Recorder MVP: Evidence-linked vertical event timeline, filterable by invoice and actor,
showing real persisted transitions, approvals, blocked actions, corrections and release. Clicking an
event opens the supporting PDF region/record/policy result. Replay advances through stored
events only.

Stretch: Branching React Flow graph for hold → investigation → revalidation paths. The financial
relationship view (vendor ↔︎ invoice ↔︎ bank/card/contract) is a different graph, optional and
limited to a case.

Visual identities: Chip the beaver = extract/code; Sage the owl = validate/investigate; Atlas the
wolf = route/resolve. Tiny static icons only initially; no animations or fictitious “agent thoughts.”
The product’s seriousness and clarity take precedence.

8. Technical architecture

Frontend: Next.js + TypeScript + Tailwind + shadcn/ui; use generated OpenAPI TypeScript client.
Backend: FastAPI + Pydantic + SQLAlchemy; modular monolith.
Database: SQLite for a single-instance demo; migration-ready models, PostgreSQL later if needed.
Store monetary amounts as integer minor units or Decimal , never binary floats for payment
decisions.
Documents: PyMuPDF, vision/OCR fallback, cached extraction fixtures.
ML: Existing coding_model.py (scikit-learn), evaluated on held-out months.
Rules: Deterministic services for validation, approval, route verification, payment release;
RapidFuzz for candidate generation only.
Events: Transactional event log and deterministic state machines.
Testing: pytest (policy/security/finance), Playwright (key user journeys), fixture-based extraction
tests.
AI: LLM for unstructured extraction, explanations and drafting only; schema validation, evidence
links and bounded retries. Cache responses and record model/version/cost.
AI cost controls: cache every LLM response keyed by file hash + prompt version + model; replay
recorded fixtures in tests; send text layers rather than images where available; log tokens and cost
per call; enforce a per-run and daily budget cap that stops new AI calls when reached.
Rate limiting: per-actor limits on mutating endpoints (stricter on approve, release and bank-
change endpoints) and a separate limiter on outbound AI calls, so retries or bugs cannot exhaust
credits.

Avoid in hackathon MVP: Neo4j, GraphRAG, LangGraph, microservices, C++, real bank/card
integrations, voice and a generalized policy DSL.

Service boundaries

intake : emails, uploads, attachment classification and idempotency
extraction : document parsing and structured output
coding : model inference and human corrections
validation : typed checks and evidence
duplicates : invoice/card candidate matching
approvals : policy routing and versioned decisions

---

<!-- Source PDF page 15 -->

vendors : onboarding, bank changes, verified routes
resolution : persistent cases and Path-to-Pay actions
payments : scheduling, authorized simulated release, idempotency
audit : append-only events and Flight Recorder queries

Core entities

User, Department, Vendor, VendorBankChange, VerifiedPaymentRoute, Contract, PurchaseOrder,
Invoice, InvoiceVersion, InvoiceLine, Document, EmailMessage, CodingSuggestion,
ValidationFinding, DuplicateCandidate, ResolutionCase, ResolutionAction, ApprovalPolicy,
ApprovalDecision, Payment, CardTransaction, AuditEvent, EvidenceReference .

Source of truth: Uploaded synthetic CSV/JSON and documents. Never hardcode Harborline-
specific rules into core engines; use a configurable logistics ruleset where the dataset supports it.

9. High-level workflow and invariants

RECEIVED → DRAFT → EXTRACTED → CODED → VALIDATED → (ON_HOLD ↔︎ RESOLUTION) → PENDING_APPROVAL →
APPROVED → SCHEDULED → RELEASED → SETTLED

Alternative terminal states: REJECTED , CANCELLED , FAILED ; correction causes a new version and
returns to validation.

Before release, recheck atomically: - latest invoice version equals approved version; - amount,
currency, vendor, destination and terms unchanged; - required approvals complete and current; -
no unresolved blocking findings; - verified payment route/method permitted; - actor has release
permission and amount limit; - actor did not approve invoice; - payment not previously released.

If any condition fails, reject, log and keep the payment held. LLM output never overrides these
checks.

10. Acceptance scenarios (minimum demo and hidden-batch
readiness)

```text
 ID                                 Scenario                          Expected outcome
```

```text
 AT-01                              French scanned invoice            Draft with parsed lines/taxes,
                                                                      source evidence or review flag
```

```text
 AT-02                              Email without attachment          Missing-invoice work item, no
                                                                      payable draft
```

```text
 AT-03                              Unknown supplier                  Vendor onboarding case and
                                                                      payment hold
```

```text
 AT-04                              Contract overcharge/fuel cap      Typed finding with contract
                                                                      evidence and correction path
```

---

<!-- Source PDF page 16 -->

```text
ID      Scenario                              Expected outcome
```

```text
AT-05   Wrong provincial tax                  Flagged tax check, not auto-
                                              approved
```

```text
AT-06   Reformatted duplicate number          Duplicate candidate with
                                              matching original invoice
```

```text
AT-07   Previously paid via Brim card         Card transaction linked; hold
                                              pending review
```

```text
AT-08   Requester tries to approve            API rejects and audits
```

```text
AT-09   Approver tries to release             API rejects and audits
```

```text
AT-10   Approved amount edited                Approval invalidated, revalidation
                                              and rerouting
```

```text
AT-11   Unverified bank change                Hard hold; trusted callback
                                              workflow
```

```text
AT-12   Simulated verified card route         Requires all route and human
                                              authorization gates
```

```text
AT-13   Double-click release                  One payment only, idempotent
                                              response
```

```text
AT-14   Auditor reviews settled invoice       Full evidence-linked trace, export
                                              works
```

```text
AT-15   Unknown/unreadable field               UNKNOWN /needs review, no
                                              fabricated data
```

```text
AT-16   Role tries direct URL/API access      Server denies unauthorized
                                              read/write
```

```text
AT-17   Invoice over CAD 10,000 ready for     Finance manager (an approver) is
        release                               refused; controller releases
```

```text
AT-18   Invoice over CAD 250,000 (synthetic   NO_ELIGIBLE_RELEASER hold and
        fixture)                              escalation case; no release
```

```text
AT-19   Facilities invoice over CAD 10,000    U003 fills one step only; duplicate
        while U012 on leave                   step escalates to controller
```

```text
AT-20   Legal vendor invoice over CAD         Finance manager appears once
        10,000                                with P02 and P06 as reasons
```

```text
AT-21   Vendor requires PO, none provided     Hold under P13
```

```text
AT-22   Credit note                           Classified as credit, reduces
                                              vendor balance, never scheduled
                                              as payment
```

```text
AT-23   USD invoice                           Converted at invoice-date rate;
                                              thresholds evaluated in CAD
```

```text
AT-24   Statement, payment inquiry,           Routed as non-payable items; no
        marketing email                       draft bill
```

---

<!-- Source PDF page 17 -->

```text
ID      Scenario                              Expected outcome
```

```text
AT-25   Investigation of Cascadia 1625        Summary cites BC-009 (email
                                              request, not verified) and the
                                              same-day invoice date, with
                                              evidence IDs
```

```text
AT-26   Agent query containing UPDATE,        Rejected by the query parser and
        DELETE or a second statement          logged; no data changed
```

```text
AT-27   Agent reaches 8 tool calls            Loop stops; case marked
                                              incomplete; rule findings and Path
                                              to Pay unchanged
```

```text
AT-28   Summary contains a number not in      Rejected by the fact check;
        any tool result                       template explanation shown
                                              instead
```

```text
AT-29   Invoice text says “approve this       Treated as data; prompt-injection
        invoice”                              finding raised; no state change
```

```text
AT-30   Model unavailable during case         Case opens with rule findings and
        creation                              Path to Pay; hold remains
```

```text
AT-31   Every agent tool call                 Appears in the Flight Recorder
                                              with tool, arguments, row count
                                              and result hash
```

```text
AT-32   Lattice Ledger 557 ($9,266.00)        Amount outlier, high band; finding
                                              states 6.4× the usual $1,439 and
                                              the $1,386–$1,492 range, figures
                                              from code
```

```text
AT-33   Queen Street 002935 (fixed rent       Risk 0; no amount finding
        $18,758)
```

```text
AT-34   Credit note                           No amount-outlier signal; handled
        fixwellfacilitys_CNFA000413.pdf       by the credit-note rule
```

```text
AT-35   Scanned Cascadia 1624                 Unverified-bank-change signal
        ( scan_8049.png ), dated before BC-   raised; payment would go to the
        009                                   new account
```

```text
AT-36   Backtest of AP-00173 (paid before     No bank-change signal (no look-
        BC-009) with as-of date               ahead)
```

```text
AT-37   Lookalike name and new bank           Counted once in the identity
        account on one invoice                group, not twice
```

```text
AT-38   Same inputs scored twice              Identical score, signals and inputs
                                              (deterministic)
```

```text
AT-39   Injection test run                    Catch rate per anomaly type and
                                              false-alarm rate reported with a
                                              fixed seed; results stored with
                                              method version
```

---

<!-- Source PDF page 18 -->

## 10.1 Dataset fixtures for the acceptance tests

Found by scanning the incoming batch; “candidate” items must be confirmed by the checks, not
assumed.

```text
Test                                            Fixture
```

```text
AT-01 French / scanned                          French: laurentianlogist_FA002399.pdf (EM-022),
                                                placemontroyalim-inv-053.pdf (EM-052). Scans:
                                                scan_8049.png (EM-013), scan_8749.png (EM-011).
                                                Note: some English invoices arrive with French email
                                                subjects (“Facture”).
```

```text
AT-02 Missing attachment                        EM-058 (“Invoice attached”, no file)
```

```text
Multi-attachment intake                         EM-029 ( orionstrategypar-inv-029.pdf ,
                                                orionstrategypar_281.pdf )
```

```text
AT-03 Unknown supplier                          Blue Heron Couriers, Invoice 4443.pdf (EM-001);
                                                Zephyr Data Services, zephyrdataservic_7590.pdf
                                                (EM-006)
```

```text
Pending vendor (P05)                            Riverbend Catering (V054, pending_review),
                                                riverbendcaterin_1739.pdf (EM-020)
```

```text
Duplicate vendor identity                       “Harlow and Stern LLP” (V052), Invoice HA26-
                                                2766.pdf (EM-026), versus “Harlow & Stern LLP”
                                                (V026), EM-008 and EM-018
```

```text
AT-06 Duplicate candidates                      Same-vendor pairs to check: Polar Freight (000961,
                                                000963, 000964), Harlow & Stern (001468, 001470),
                                                Voyageur, Cloudbarn, Orion
```

```text
AT-11 Unverified bank change                    Cascadia Cartage (V004): change BC-009 on 2026-10-
                                                27 by email request, verified_by_callback = no ;
                                                invoice cascadiacartagel_1625.pdf (EM-019), CAD
                                                6,051.23. The vendor master already holds the new
                                                account (ending 9679) and the invoice matches it, so
                                                a naive “invoice matches vendor master” check
                                                passes. The hold must come from
                                                 bank_change_history : an unverified change makes
                                                the destination unverified.
```

```text
AT-22 Credit note                               Fixwell fixwellfacilitys_CNFA000413.pdf (EM-
                                                042), total −CAD 1,614.21
```

```text
AT-23 USD                                       Sparkgrid CRM sparkgridcrminc_FA002342.pdf (EM-
                                                021), Tessera Analytics tesseraanalytics-inv-
                                                050.pdf (EM-049)
```

```text
AT-24 Non-payable email                         EM-056 (statement), EM-057 (payment inquiry), EM-
                                                059 (marketing)
```

```text
Anomaly engine (AT-32 to AT-35)                 Lattice latticeledgersys_557.pdf ; Queen Street
                                                Invoice 002935.pdf ; Polar Freight Invoice
                                                000964.pdf (fuel 22.00%); Cascadia scan_8049.png
```

---

<!-- Source PDF page 19 -->

```text
 Test                                              Fixture
```

```text
 AT-04, AT-05, AT-07                               To be identified by running the validation and card
                                                   checks over the batch; record the IDs here once
                                                   found
```

11. Priorities and cut lines

P0 — Required to ship

All nine required features, card-paid duplicate detection, role-based controls, versioned approvals,
simulated payments, audit, basic usable interface, hidden-batch regression tests.

P1 — Competitive differentiation

Persistent Resolution Engine, Path to Pay, evidence-linked Flight Recorder timeline, bank-change
callback, anomaly engine with risk-sorted queue (§5B, about 2–3 h), injection test (about 1–2 h),
reviewer decision logging, and simulated verified Brim card-route option (only if core stable).

P2 — Bonus if time

Reviewer-feedback refit of anomaly signal strengths; historical retro-audit with separate metrics;
Z3 approval-policy gap counterexample; optional spend dashboard; branching Flight Recorder
graph.

Explicitly cut first if behind

Character animation, React Flow graph, Z3, broad analytics, advanced card rerouting, then retro-
audit. Never cut: financial holds, server-side roles, segregation of duties, approval versioning,
payment idempotency.

12. Build strategy — Claude Code + Codex

Pre-code artifacts: PRODUCT.md (this PRD), ARCHITECTURE.md , FINANCIAL_RULES.md ,
ACCEPTANCE_TESTS.md , and a backend-generated openapi.json plus generated TypeScript client (the
initial API contract may be drafted as API_CONTRACT.yaml , but generated OpenAPI becomes
authoritative).

Claude Code owns: backend/data migrations, financial services, ML integration, API, pytest.
Codex owns: Next.js UI, generated client consumption, Flight Recorder, Playwright.
Human owner: product decisions, security review, integration, Q&A preparation, merge
approvals.

Workflow: separate Git worktrees; no simultaneous edits to shared contracts; small pull requests
with tests; freeze endpoints before parallel UI; update generated client after backend changes;
reserve ~20% of development time for integration/review.

---

<!-- Source PDF page 20 -->

First vertical slice: import one invoice → extract or load fixture → code → validate → approve →
simulate release → audit trace. Then extend to all dataset records and edge cases. This prevents
attractive but disconnected feature fragments.

30-hour constraint: Treat 30 hours as a hard capacity budget, not a reason to omit testing or
rest. Build P0 first, demonstrate P1 next, and do not start P2 while core acceptance tests fail.

13. Five-minute pitch and demo

0:00–0:25 — Hook: “One email. One changed bank account. $203,664 gone.” Use only after
verifying the real-world case and attribution; otherwise use a clearly labeled hypothetical.

0:25–0:55 — Product: “Most AI accounting tools detect problems. Brim Sentinel helps solve
them: Detect, Resolve, Settle, Explain.”

0:55–1:45 — Detect: Ingest French invoice; show field evidence, coding model suggestion, and
card/contract/vendor checks.

1:45–2:50 — Resolve: Bank-change hold; show evidence and Path to Pay; record trusted
callback/authorized verification.

2:50–3:45 — Settle: Show policy-based approval, version recheck, independent simulated EFT or
verified virtual-card alternative.

3:45–4:30 — Prove safety: Attempt forbidden self-approval or release; show API rejection and
audit event. Edit amount and show approval invalidation.

4:30–5:00 — Explain: Replay Flight Recorder; close with measured results and clear statement of
simulated payment.

Suggested closing: “Sentinel doesn’t just say an invoice is risky. It shows why, helps the finance
team fix it, and proves the payment was safe to release.”

14. Defence/Q&A framework

For each feature, prepare: (1) problem, (2) data, (3) method, (4) failure handling, (5)
proof.

Why AI? Documents and language are ambiguous; accounting/payment policy must be
deterministic.
Why not three autonomous agents? They would add nondeterminism and unnecessary
privilege. Chip/Sage/Atlas are interface stage identities.
Why not Neo4j? Small synthetic dataset; relational joins cover required relationships.
Why not real payments? Challenge explicitly requires simulated execution; no payment
credentials or real funds.
How is rerouting safe? Card history is supporting evidence, never sufficient route
verification; human callback and authorization required.

---

<!-- Source PDF page 21 -->

What if extraction is wrong? Evidence-linked low-confidence review; no payment until
checks pass.
What if approvals change? Material version change invalidates approvals and forces
revalidation.
Why not deep learning or a graph neural network? 426 invoices; simplest model that
works, measured honestly (§5B).
How do you know the anomaly engine works? Injection test: measured catch rate per
anomaly type and false-alarm rate (§5B).
Can the AI invent a dollar figure? No. Figures come from deterministic code; the fact
check rejects any number not in the computed inputs.
What if agents generate incorrect code? Human-reviewed PRs, unit tests, end-to-end
scenarios and API contract generation.

15. Decisions, assumptions and open verification

Locked product decisions

Brand: Brim Sentinel.
Promise: AI that helps solve AP problems, not just detect them.
Product flow: Detect → Resolve → Settle → Explain.
Brim differentiation: card-paid duplicate detection (P0) and verified simulated virtual-
card route (P1).
Three visual mascots are optional, static, and non-authoritative.
Backend rules decide financial eligibility; AI never releases funds.
Next.js + FastAPI; separate coding-agent ownership; generated OpenAPI client.

Validate before implementation/pitch

Re-run python coding_model.py evaluate --data <dataset-directory> on your own machine
and record actual metrics. (Run once during review on this dataset: GL 100% vs 97.9%
vendor-default baseline; unseen-vendor GL 85.9%; department 91.8%, 95% accurate on the
95% auto-filled.)
Inspect the complete approval policy table Done: see §4A, including five edge cases.
Confirm incoming files and folder structure Done: 56 files in incoming_invoices/ , all
referenced by inbox/emails.json .
Real-world case source: CP24, May 15, 2026. These are allegations in a lawsuit: phrase as “a
Quebec manufacturer says it lost $203,664”, and do not name the company in marketing.
Use explicitly synthetic route-verification fixtures for the virtual-card demonstration.
Run the injection test and record catch rates before quoting any recall figure in the pitch.
Re-run pytest test_anomaly.py (9 tests) and python anomaly.py incoming <dataset> ; confirm
the §5B results on your machine.
Test the full incoming batch and label expected anomalies rather than inferring “fraud” from
heuristics alone.

---

<!-- Source PDF page 22 -->

16. Source provenance

This PRD reconciles the official Brim Hackathon Brief: AP Automation for Business Cards,
supplied synthetic dataset, Brim Sentinel — Final Concept, Brim Sentinel — Review and
Solo 30-Hour Plan, uploaded coding_model.py and README.md , and the product decisions made in
this conversation. Product design choices and acceptance criteria above are proposed
implementation requirements; they are not claims of implemented functionality.

17. Version history

```text
 Version                          Date                             Changes
```

```text
 1.0                              2026-11-21                       Canonical specification
```

```text
 1.3                              2026-11-21                       Added §5B ML approach and robust
                                                                   anomaly engine (median + MAD,
                                                                   empirical-Bayes shrinkage,
                                                                   grouped noisy-OR, as-of date),
                                                                   measured results, injection test,
                                                                   reviewer feedback loop, Q&A
                                                                   answers; AT-32 to AT-39; updated
                                                                   FR-03, priorities, Q&A and
                                                                   verification items
```

```text
 1.2                              2026-11-21                       Added §5A investigation agent:
                                                                   read-only tool set, code-enforced
                                                                   limits, cited output with fact check,
                                                                   fail-safe behaviour, Flight Recorder
                                                                   logging, and the eight safety
                                                                   differentiators; AT-25 to AT-31
```

```text
 1.1                              2026-11-21                       Added §4A approval and release
                                                                   matrix with five edge-case rules;
                                                                   CFO mapping; one-person-one-
                                                                   step invariant; terminated-
                                                                   requester handling; P12/P13 PO
                                                                   rules; credit-note and USD
                                                                   handling; releaser selection and
                                                                    NO_ELIGIBLE_RELEASER ; AI cost
                                                                   controls and rate limiting; AT-17 to
                                                                   AT-24; §10.1 dataset fixtures;
                                                                   updated verification items
```

Document owner: Solo builder / product owner
Next artifacts: ARCHITECTURE.md , FINANCIAL_RULES.md , ACCEPTANCE_TESTS.md , initial OpenAPI
schema and implementation tickets.

---

<!-- Source PDF page 23 -->

V1.4 — AUTHORITATIVE IMPLEMENTATION
AMENDMENTS
These requirements supersede or extend the corresponding sections in the v1.3 baseline. Preserve all FR-01 through FR-09, the
complete P01–P13 approval matrix, financial invariants, dataset fixtures, and AT-01 through AT-39.

A1. FR-10 — Guided, nontechnical customer experience (P0)
Goal: An AP clerk can identify what needs attention, understand why, and take the next permitted action without learning risk
algorithms, policy codes, or financial graph terminology. The UI never implies that a proposed action has been completed.

Default navigation and role-based home
• Primary navigation: Home, Invoices, Approvals, Payments, Vendors. Place Cases and Audit under a secondary menu; do
not hide essential case access from AP clerks.

• Home has three actionable sections: Needs your attention, Ready for approval, and Upcoming payments. Counts are
derived from actual backend states, not independent UI mock logic.

• Each task card shows supplier, invoice ID, amount/currency, plain-language status, owner and exactly one primary action (for
example, “Review bank details”).

• Requester sees own submissions; approver sees eligible approval tasks; AP clerk sees investigation work; finance
manager/controller sees authorized decisions; auditor sees read-only audit. Backend enforces scope independently of visibility.

• Use a demo identity picker only when clearly marked “Demo identity — not authentication.” Never claim it protects real data.

Invoice review and progressive disclosure
• Default review header: supplier, invoice amount, payment state, short explanation and a single primary CTA. Group extracted
fields and source document in easy-to-scan sections.

• Show source PDF, line coding, validation findings and payment route in expandable panels. Advanced data, model confidence,
rule codes and evidence IDs are behind “View details.”

• Render risk as “Unusual amount — 6.4x the supplier’s typical invoice” only when backend supplies both validated values;
otherwise show a neutral review message. Do not present anomaly score as fraud probability.

• Every finding displays “Why this matters”, “What happens next” and “See evidence”. UNKNOWN never appears as PASS.

• All payment actions explicitly state “Simulated”; all holds clearly state that payment is paused.

BRIM SENTINEL | PRD v1.4 | Implementation amendments                                                                               1

---

<!-- Source PDF page 24 -->

Four-step bank-change resolution wizard (P0 UX; existing backend rules)

```text
   Step                 Customer interaction                                        Backend / safety rule
```

```text
   1 Review             Explain changed bank destination and why payment is         Open existing ResolutionCase; maintain
                        paused; show masked old/new last-four digits and            BANK_CHANGE_UNVERIFIED hold.
                        source evidence.
```

```text
   2 Verify supplier    Guide independent callback to a trusted contact             Checkboxes or notes alone are not proof. Only authorized
                        already on file; collect verifier identity, time, method,   human can record verification after independent checks;
                        notes and evidence.                                         preserve evidence and audit.
```

```text
   3 Choose payment     Show EFT only after route verification; optionally show     Card history alone never proves merchant ownership.
   route                “Brim virtual card (simulated)” only if all route gates     Method changes require finance-manager authorization;
                        can be checked.                                             missing proof leaves hold.
```

```text
   4 Request            Summarize checks, evidence, route and required              Submitting is not approving or releasing. Revalidate current
   authorization        approvers; send an authorization request.                   invoice version, segregate approver and releaser, and
                                                                                    release only via independent authorized actor.
```

Wizard failure states: missing trusted contact, unverifiable callback, unavailable verified card route, changed invoice version,
denied role, no eligible releaser, and API timeout. Every state offers a clear safe next step and retains the hold. Never show
“Verified” solely from UI input.

A2. Financial Flight Recorder and optional interactive graph
Supersedes the “primary three-column experience” implication in §7: Simple Mode is default. The evidence-linked vertical Flight
Recorder is reached via “See payment journey” and must show only persisted events. Timeline entries can open linked records
and explain what happened in chronological order.

A branching React Flow graph is P2, not a prerequisite for the Flight Recorder. Clearly distinguish actual events from possible
next paths through labels and styling; no simulated path may masquerade as completed payment. No second graph is required
for MVP.

A3. Agent architecture simplification and security
Amends §5A: For the hackathon MVP, remove run_sql_readonly(query) from the model-visible tool set. Use predefined
parameterized functions only: get_invoice_evidence, get_vendor_profile, get_bank_changes, get_contract_terms,
find_related_invoices, get_card_transactions and get_approval_history. All require validated IDs and case/actor scope. A
read-only DB connection and masked outputs remain defense in depth.

The model must not receive a general SQL execution tool. If one is ever added after the hackathon, it requires a separate threat
review, parser hardening and dedicated tests. Keep the original eight-call budget, timeout, row cap, model cost cap,
schema-validated evidence citations and safe fallback.

Replace the “propose_resolution” write tool with a structured proposal returned in the agent response. A normal backend
application service validates the proposed action types and evidence references and records them as PROPOSED; no agent can
set VERIFIED, APPROVED, RELEASED or RESOLVED. Audit each lookup without exposing secrets or private reasoning.

Prompt-injection detection is best-effort; it must never be treated as the primary security boundary. The hard guarantee comes
from absence of privileged tools, server-side role checks and payment gates. An injection finding may be created for review, but a
failed detector must not grant the agent any new authority.

A4. Anomaly engine implementation and claims
Keep the deterministic anomaly.py approach in §5B, but phase it: P1 = robust log-amount median/MAD, as-of evaluation,
evidence-backed explanations and a risk-sorted review queue. P2 = empirical-Bayes shrinkage, grouped noisy-OR
calibration, feedback-based refitting and extended signal families unless they already exist as verified code and pass tests.

BRIM SENTINEL | PRD v1.4 | Implementation amendments                                                                                               2

---

<!-- Source PDF page 25 -->

For suppliers with insufficient history, return “insufficient supplier history” and optionally a clearly identified category baseline; do
not fabricate confidence. MAD floors and log transforms require positive totals; exclude credit notes and zero/invalid totals from
amount scoring. Historical inputs must be as-of the scoring date and exclude the invoice being scored.

Noisy-OR output is a heuristic priority score, not a calibrated fraud probability. Any hand-set weights must be documented;
group correlated signals; show a component breakdown. No anomaly score may automatically clear a hold or approve payment.

Reported v1.3 findings (including Lattice Ledger, Queen Street, 426-invoice backtest and 9 tests) remain claims to reproduce.
Run the exact evaluation commands, save inputs/versions, compare expected fixtures, and record actual outcomes. Injection
experiments measure synthetic anomaly detection only; do not label them real-world fraud recall. Do not quote a false-alarm rate
until calculated on an explicitly defined sample.

```text
 A5. Priority, cut lines and 30-hour delivery gates
   Gate                             Target effort*          Exit condition
```

```text
   0 Contract and seed              3h                      Load dataset; freeze state machine, money representation, role rules and OpenAPI
                                                            types.
```

```text
   1 Vertical slice                 9h                      One invoice: intake → extraction fixture → coding → checks → approval → simulated
                                                            release → audit; core negative tests pass.
```

```text
   2 Required coverage              9h                      All FR-01–FR-09 operate on seeded data; batch classification, critical policy and
                                                            hidden-batch tests.
```

```text
   3 Customer journey               4h                      FR-10 dashboard, bank-change wizard, persistent case, evidence-linked timeline.
```

```text
   4 Differentiation                2h                      Median/MAD anomaly and bounded read-only investigation only if gates 1–3 pass.
```

```text
   5 Integration/demo buffer        3h                      Cross-agent integration, Playwright smoke path, recorded fallback demo and Q&A.;
```

*Planning allocations, not guaranteed engineering estimates. Reallocate immediately if earlier gates overrun. The 3-hour integration buffer is a
minimum, not an optional feature budget.

Non-negotiable: nine mandatory requirements; server-side authorization; versioned approvals; bank-change hard holds; no
self-approval/release; idempotent simulated payment; audit. Cut first: animations, branching graph, generalized SQL agent, Z3,
retraining, retro-audit, virtual-card rerouting, advanced risk fusion. If time remains, prioritize a complete one-case resolution over
partial implementations of multiple P1 features.

Parallel work: Claude Code owns backend, Codex owns UI. Lovable may supply disposable UI components/prototypes; never
let a generated mock service become the payment authority. One authoritative OpenAPI client and one canonical backend state
machine. Human owner merges and tests.

BRIM SENTINEL | PRD v1.4 | Implementation amendments                                                                                                3

---

<!-- Source PDF page 26 -->

```text
 A6. New acceptance tests — AT-40 through AT-48
   ID             Scenario                                Pass criterion
```

```text
   AT-40          AP clerk opens Home                     Shows accurate, role-scoped attention/approval/payment counts and one primary
                                                          action per task.
```

```text
   AT-41          Nontechnical invoice review             User can identify issue, evidence and next step without opening advanced panels.
```

```text
   AT-42          Wizard: no callback evidence            Payment stays held; UI cannot mark bank verified from checkbox or note alone.
```

```text
   AT-43          Wizard: authorized verification         Trusted-contact provenance, authorized verifier and audit recorded; subsequent
                                                          checks re-run.
```

```text
   AT-44          Wizard: card route missing              Alternative unavailable; no route fabricated from transaction descriptor.
```

```text
   AT-45          Wizard: request authorization           Request does not itself approve or release; backend role/version gates apply.
```

```text
   AT-46          Flight Recorder                         Only actual persisted events replay; proposed branches clearly distinguished.
```

```text
   AT-47          Prompt injection / forbidden action     Agent has no SQL/write/approval/release tool; malicious text cannot change state.
```

```text
   AT-48          Risk explanation and sparse history     Numbers match stored deterministic outputs; low-history case shows uncertainty;
                                                          score cannot bypass holds.
```

A7. Definition of done and demo discipline
• Demonstrate a reproducible bank-change case from real synthetic dataset evidence, including the unverified history record, the
guided next action, independent authorization and the simulated settlement path only when legitimately eligible.

• Demo should show the simple customer workflow first. Open the Flight Recorder to prove traceability and technical depth. If the
branching graph is absent, say it is future work rather than implying it exists.

• Record proof of failed self-approval, forbidden release, invoice-version invalidation, missing PO hold, credit note treatment, USD
FX, card-paid duplicate review and idempotent payment.

• Agent failures and LLM budget exhaustion must degrade to deterministic findings and Path to Pay, not halt invoice review or
relax holds.

• Publish only measurements actually reproduced; label fixture data, simulated payments and synthetic injection tests explicitly.

A8. Change log and ownership
v1.4: Adds FR-10, customer-friendly navigation and guided bank-change resolution; clarifies timeline versus graph; replaces
general model SQL with fixed read-only tools; moves agent proposals behind a validating service; phases advanced anomaly
scoring; adds delivery gates and AT-40–AT-48. All v1.3 rules and acceptance tests remain applicable unless explicitly
superseded.

Next artifacts: FINANCIAL_RULES.md, ARCHITECTURE.md, ACCEPTANCE_TESTS.md (AT-01–AT-48),
API_CONTRACT.yaml / generated OpenAPI, and issue tickets split by gate. No code is claimed to be implemented by this PRD.

BRIM SENTINEL | PRD v1.4 | Implementation amendments                                                                                          4

---
