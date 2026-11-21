# Financial rules — as implemented (backend)

Source: PRD v1.4 §4A (P01–P13 + five edge cases), FR-04/06/07/09. Implementation:
`app/services/approval_policy.py`, `validation.py`, `payments.py`, `bank.py`. Money is integer
minor units; thresholds compare CAD minor units at the invoice-date FX rate (`fx_rates.csv`,
ROUND_HALF_UP). "Over" means strictly greater than (CAD 10,000.00 → P01 only; 10,000.01 → P02).

## Approval chain (built per invoice version)

| Rule | Condition | Effect |
|---|---|---|
| P01 | CAD ≤ 10,000 | dept manager of the requesting department |
| P02 | CAD > 10,000 | + finance manager (U003) |
| P03 | CAD > 50,000 | + controller (controller_admin not titled CFO → U002) |
| P04 | CAD > 250,000 | + CFO (controller_admin titled "Chief Financial Officer" → U001; fail closed if not exactly one) |
| P05 | vendor `pending_review`/`new` | + finance manager (merged) |
| P06 | vendor category Legal | + finance manager (merged) |
| P07 | assigned approver is the requester | escalate to that approver's manager |
| P08 | approver on leave | route to `delegate_user_id`; both identities recorded |
| P12 | PO referenced and subtotal > PO remaining balance | + finance manager (merged), non-blocking finding |
| P13 | vendor `requires_po=yes`, no PO | **hard hold** `PO_MISSING` |

* Steps are ordered dept → finance → controller → CFO; decided strictly in order.
* Duplicate finance steps merge into one step listing every triggering rule (e.g. `["P02","P06"]`).
* **One person, one step per version.** Fixed-role steps are assigned first; a step whose person
  already holds another step escalates up the ladder (controller → CFO). Facilities (U012 on leave
  → U003) above CAD 10k therefore puts **U002** on the department step (reason recorded) and U003 on
  the finance step. If no one remains → `NO_ELIGIBLE_APPROVER` hard hold.
* An assignee's own limit must cover `min(amount, step ceiling)` (10k / 50k / 250k / 500k).
  Above CAD 500k nobody can approve → `NO_ELIGIBLE_APPROVER`.
* Terminated users (U015) are never assigned and cannot act; the department manager owns rework.
* AI/service identities (`SVC-SENTINEL`) have no permissions at all.

## Release (P09–P11)

* ≤ CAD 100,000: `finance_manager` or a non-approving `controller_admin`; > CAD 100,000: `controller_admin`.
* The releaser must not have approved the version (P11), must not be the requester, and must not be
  the person who scheduled the payment.
* Predictive check at routing time: if every holder of release authority is in the chain →
  `NO_ELIGIBLE_RELEASER` hard hold + case owned by the controller. Documented decision options are
  `reject_invoice` or `keep_on_hold`; **there is no release override.** (>250k always lands here;
  so does a Facilities invoice > 50k because the delegate collision escalates the dept step to the CFO.)
* Release transaction (`BEGIN IMMEDIATE`) re-reads: current version = scheduled version = client's
  expected version; amount/currency unchanged; no blocking findings; no open bank change for the vendor;
  route VERIFIED; all steps approved for this version; role authority; SoD. Idempotency: same
  `(actor, operation, key)` + same payload → original response (`idempotent_replay=true`); different
  payload → 409; a second release of a released payment → 409. A partial unique index allows at most
  one live simulated payment per invoice version.

## Versioning

Every edit (fields, lines, PO, department, coding override) creates a new immutable version with
provenance `manual`. Approvals are bound to `(invoice, version, step)` and therefore no longer count;
`approvals.invalidated` is audited; any scheduled payment is cancelled; full revalidation runs.
Stale `expected_version` → 409 `INVOICE_VERSION_CONFLICT` with no side effects.

## Hard holds (never dismissible)

`EXTRACTION_INCOMPLETE`, `UNKNOWN_VENDOR`, `VENDOR_INACTIVE`, `TOTALS_MISMATCH`, `TAX_MISMATCH`,
`FX_RATE_MISSING`, `DUE_BEFORE_INVOICE_DATE`, `PO_MISSING`, `PO_NOT_FOUND/VENDOR_MISMATCH/CLOSED`,
`BANK_CHANGE_UNVERIFIED`, `BANK_DETAILS_MISMATCH`, `PAYMENT_ROUTE_UNAVAILABLE`, `DEPARTMENT_UNASSIGNED`,
`LOW_CODING_CONFIDENCE` (cleared by a coding decision), `NO_ELIGIBLE_APPROVER`, `NO_ELIGIBLE_RELEASER`.

Dismissible by finance_manager/controller with a ≥10-char reason (per version; audited; never clears
another hold): duplicate candidates/card-paid/confirmed duplicate, look-alike vendor identity,
contract rate/fuel/cap/expiry exceptions, future-dated invoice, prompt-injection text, tax-unverifiable.

## Bank changes (FR-09, wizard)

`bank_change_history` rows with `verified_by_callback=no` (BC-009, Cascadia V004) are hard holds for
**every** open invoice of the vendor — even when the invoice account equals the vendor master
(1625 and the scanned 1624, which pre-dates the change). Verification requires: a trusted contact that
was on file **before** the change (vendor-master contact, `established_at < requested_at`; contacts
from an onboarding application are not trusted), a verifier other than the person who entered the
change, method, time, notes and an evidence reference. Unknown request fields (e.g. `verified: true`)
are rejected with 422. Route authorization is a second person (finance_manager/controller, not the
verifier or requester); it marks the route VERIFIED with full provenance and revalidates the vendor's
open invoices. A `DENIED` callback rejects the change and revokes the route; the hold remains.

## Validation specifics

* Tax by delivery (bill-to) province: ON HST 13%; QC GST 5% + QST 9.975% on pre-tax; BC GST 5% + PST 7%
  on goods (goods/services from the vendor's historical line types; mixed/unknown → UNKNOWN); AB/territories
  GST 5%; foreign vendors none; Insurance exempt. Tolerance 1 cent per tax line.
* Arithmetic: qty × unit within 1 cent; lines must sum to subtotal exactly; subtotal + taxes = total exactly.
* Contracts: active contract covering the invoice date; fixed monthly fee; hourly-rate cap on lines
  mentioning hours; fuel-surcharge cap (stated % on the line, computed % reported too); monthly NTE
  across the vendor's invoices in the same calendar month.
* Credit notes (negative total): never routed, never schedulable, PO rule N/A → `CREDIT_RECORDED`,
  reduces the vendor's balance (`GET /vendors/{id}` → `credit_balance_minor`).
