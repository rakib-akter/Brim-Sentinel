"""Canonical API DTOs (master brief §20). Money = integer minor units + currency.
Bank account numbers are only ever exposed masked (****1234)."""
from __future__ import annotations

import datetime as dt
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    """Request bodies reject unknown fields (e.g. a client-sent `verified=true` is a 422)."""
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------ errors
class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = {}
    correlation_id: str


class ErrorResponse(BaseModel):
    error: ErrorBody


# ------------------------------------------------------------------ identity
class UserOut(BaseModel):
    id: str
    full_name: str
    title: str
    role: str
    department_id: str | None
    manager_id: str | None
    status: str
    status_since: str | None
    delegate_user_id: str | None
    approval_limit_minor: int
    kind: str


class MeOut(BaseModel):
    user: UserOut
    permissions: list[str]
    demo_notice: str = "Demo identity — not authentication."


class DemoIdentitiesOut(BaseModel):
    demo_notice: str = "Demo identity — not authentication."
    users: list[UserOut]


# ------------------------------------------------------------------ invoices
class PrimaryAction(BaseModel):
    kind: str
    label: str


class InvoiceSummary(BaseModel):
    id: str
    invoice_number: str | None
    vendor_id: str | None
    vendor_name: str | None
    version: int
    row_version: int
    kind: Literal["invoice", "credit_note"]
    currency: str | None
    amount_minor: int | None
    amount_cad_minor: int | None
    invoice_date: str | None
    due_date: str | None
    lifecycle_state: str
    plain_status: str
    risk_band: str | None
    risk_score: str | None
    blocking_findings_count: int
    allowed_actions: list[str]
    blocked_reasons: list[str]
    source_kind: str
    department_id: str | None
    requester_id: str | None
    owner: str | None
    primary_action: PrimaryAction


class FindingOut(BaseModel):
    id: str
    invoice_id: str
    version: int
    check: str
    code: str
    result: Literal["PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE"]
    severity: str
    blocking: bool
    dismissible: bool
    title: str
    rationale: str
    why_it_matters: str | None
    next_action: str | None
    policy_ids: list[str]
    evidence_refs: list[dict[str, Any]]
    data: dict[str, Any]
    dismissed_by: str | None
    dismissal_reason: str | None


class LineOut(BaseModel):
    line_no: int
    description: str
    quantity: str
    unit_price_minor: int | None
    amount_minor: int | None
    line_type: str | None
    gl_account: str | None
    gl_name: str | None
    department_id: str | None
    coding_confidence: str | None
    coding_status: str | None
    coding_method: str | None
    alternatives: list[dict[str, Any]]
    similar_lines: list[dict[str, Any]]


class ApprovalStepOut(BaseModel):
    id: str
    step_index: int
    step_key: str
    required_role: str
    trigger_policy_ids: list[str]
    eligible_actor_ids: list[str]
    assigned_actor_id: str | None
    assigned_actor_name: str | None
    delegated_from_id: str | None
    escalation_reason: str | None
    status: Literal["APPROVED", "REJECTED", "PENDING", "WAITING"]
    decided_by_id: str | None
    decided_at: dt.datetime | None
    decision_reason: str | None


class DuplicateOut(BaseModel):
    id: str
    match_type: str
    confirmed: bool
    score: int
    matched_invoice_id: str | None
    matched_card_txn_id: str | None
    reasons: list[str]


class PaymentOut(BaseModel):
    id: str
    invoice_id: str
    invoice_version: int
    method: str
    route_id: str | None
    currency: str
    amount_minor: int
    amount_cad_minor: int
    state: str
    simulation: bool
    label: str
    source: str
    prepared_by_id: str | None
    released_by_id: str | None
    reference: str | None
    idempotency_key_hash: str | None
    scheduled_date: str | None
    created_at: dt.datetime
    released_at: dt.datetime | None
    settled_at: dt.datetime | None


class ReleaseOut(PaymentOut):
    idempotent_replay: bool


class CaseSummary(BaseModel):
    id: str
    invoice_id: str
    invoice_version: int
    case_type: str
    title: str
    state: str
    severity: str
    owner_role: str
    owner_id: str | None
    finding_ids: list[str]
    bank_change_id: str | None
    closure_outcome: str | None
    row_version: int
    allowed_actions: list[str]
    created_at: dt.datetime
    updated_at: dt.datetime


class VersionOut(BaseModel):
    version: int
    created_at: dt.datetime
    created_by: str
    reason: str
    provenance: str
    total_minor: int | None
    currency: str | None


class AnomalyOut(BaseModel):
    method_version: str
    status: str
    band: str
    score: str
    as_of: str
    label: str = "Review priority — not a fraud probability. Never creates or clears a hold."
    signals: list[dict[str, Any]]
    inputs: dict[str, Any]


class InvoiceDetail(InvoiceSummary):
    provenance: str
    language: str | None
    document_refs: list[dict[str, Any]]
    extracted_fields: dict[str, Any]
    uncertain_fields: list[str]
    line_items: list[LineOut]
    taxes: list[dict[str, Any]]
    subtotal_minor: int | None
    fx: dict[str, Any] | None
    remit: dict[str, Any]
    validation_findings: list[FindingOut]
    duplicate_candidates: list[DuplicateOut]
    approval_chain: list[ApprovalStepOut]
    eligible_releasers: list[str]
    resolution_cases: list[CaseSummary]
    payment_summary: PaymentOut | None
    anomaly: AnomalyOut | None
    versions: list[VersionOut]
    evidence_refs: list[dict[str, Any]]


class InvoiceListOut(BaseModel):
    items: list[InvoiceSummary]
    total: int
    limit: int
    offset: int


# ------------------------------------------------------------------ cases / bank
class ContactOut(BaseModel):
    id: str
    channel: str
    value: str
    source: str
    established_at: str


class BankChangeOut(BaseModel):
    id: str
    vendor_id: str
    requested_at: str
    requested_by_user_id: str | None
    request_channel: str
    old_account_masked: str | None
    new_account_masked: str | None
    state: str
    source: str
    verifier_id: str | None
    trusted_contact_id: str | None
    verification_method: str | None
    verification_occurred_at: str | None
    verification_outcome: str | None
    verification_evidence_ref: str | None
    authorized_by_id: str | None
    authorized_at: str | None
    row_version: int
    trusted_contacts: list[ContactOut]
    allowed_actions: list[str]


class CaseActionOut(BaseModel):
    id: str
    action_type: str
    status: str
    actor_id: str | None
    notes: str | None
    data: dict[str, Any]
    created_at: dt.datetime


class WizardOut(BaseModel):
    """Four-step bank-change wizard state derived from persisted backend state."""
    current_step: Literal["review", "verify_supplier", "choose_route", "request_authorization", "done"]
    steps: list[dict[str, Any]]
    route_options: list[dict[str, Any]]
    failure_states: list[str]
    hold_active: bool


class CaseDetail(CaseSummary):
    path_to_pay_steps: list[dict[str, Any]]
    findings: list[FindingOut]
    actions: list[CaseActionOut]
    evidence_refs: list[dict[str, Any]]
    bank_change: BankChangeOut | None
    wizard: WizardOut | None
    invoice: InvoiceSummary


class CaseListOut(BaseModel):
    items: list[CaseSummary]
    total: int


# ------------------------------------------------------------------ vendors
class RouteOut(BaseModel):
    id: str
    method: str
    account_masked: str | None
    status: str
    provenance: str
    verified_at: str | None
    bank_change_id: str | None


class VendorOut(BaseModel):
    id: str
    legal_name: str
    category: str | None
    status: str
    country: str | None
    province_or_state: str | None
    requires_po: bool
    preferred_payment_method: str | None
    accepts_card_payment: bool
    bank_account_masked: str | None
    has_open_bank_change: bool
    source: str


class VendorDetail(VendorOut):
    gst_hst_number: str | None
    payment_terms_days: int | None
    contacts: list[ContactOut]
    bank_changes: list[BankChangeOut]
    routes: list[RouteOut]
    similar_identities: list[dict[str, Any]]
    open_payable_minor: int
    credit_balance_minor: int
    contracts: list[dict[str, Any]]


# ------------------------------------------------------------------ audit / dashboard
class AuditEventOut(BaseModel):
    id: int
    occurred_at: dt.datetime
    actor_id: str | None
    actor_kind: str
    action: str
    object_type: str
    object_id: str
    object_version: int | None
    invoice_id: str | None
    result: str
    policy_ids: list[str]
    evidence_refs: list[Any]
    before_state: str | None
    after_state: str | None
    details: dict[str, Any]
    hash: str
    prev_hash: str | None


class AuditListOut(BaseModel):
    items: list[AuditEventOut]
    total: int
    limit: int
    offset: int


class FlightEvent(BaseModel):
    kind: Literal["persisted", "proposed"]
    id: str
    occurred_at: dt.datetime | None
    actor_id: str | None
    actor_name: str | None
    action: str
    label: str
    before_state: str | None
    after_state: str | None
    result: str | None
    policy_ids: list[str]
    evidence_refs: list[Any]


class FlightRecorderOut(BaseModel):
    invoice_id: str
    as_of: dt.datetime
    events: list[FlightEvent]
    proposed_next: list[FlightEvent]
    note: str = "Persisted events only. 'proposed' entries have NOT happened."


class TaskOut(BaseModel):
    invoice: InvoiceSummary
    plain_status: str
    owner: str | None
    primary_action: PrimaryAction


class WorkItemOut(BaseModel):
    id: str
    email_id: str | None
    item_type: str
    status: str
    note: str | None
    subject: str | None
    from_name: str | None
    payable: bool


class DashboardOut(BaseModel):
    actor_id: str
    role: str
    counts: dict[str, int]
    needs_attention: list[TaskOut]
    ready_for_approval: list[TaskOut]
    upcoming_payments: list[TaskOut]
    work_items: list[WorkItemOut]
    demo_notice: str = "Demo identity — not authentication."


class ImportOut(BaseModel):
    counts: dict[str, Any]


class UploadOut(BaseModel):
    created: bool
    invoice: InvoiceSummary


class InvestigationOut(BaseModel):
    summary: str
    evidence: list[str]
    proposed_actions: list[str]
    open_questions: list[str]
    complete: bool
    source: Literal["deterministic_template", "model"]
    rejected_reason: str | None
    lookups: list[dict[str, Any]]
    case_state_unchanged: bool
    proposals_status: str


# ------------------------------------------------------------------ requests
class VersionedRequest(Strict):
    expected_version: int = Field(..., description="Current invoice version the client acted on (409 if stale).")


class EditFieldsRequest(VersionedRequest):
    reason: str
    fields: dict[str, Any] = Field(..., description="Editable: vendor_id, invoice_number, invoice_date, due_date, "
                                   "currency, subtotal, total, taxes[{label,kind,rate_pct,amount}], po_number, "
                                   "department_id, requester_id, ship_to_province, terms, "
                                   "lines[{description,quantity,unit_price,amount}]. Decimal strings for money.")


class CodingLine(Strict):
    line_no: int
    gl_account: str | None = None
    department_id: str | None = None
    reason: str | None = None


class CodingDecisionRequest(VersionedRequest):
    lines: list[CodingLine]


class DismissRequest(VersionedRequest):
    reason: str


class CancelRequest(VersionedRequest):
    reason: str


class ApprovalDecisionRequest(VersionedRequest):
    decision: Literal["APPROVED", "REJECTED"]
    reason: str | None = None


class PrepareRequest(VersionedRequest):
    invoice_id: str
    method: Literal["EFT", "CARD", "CHEQUE"] | None = None


class ReleaseRequest(Strict):
    expected_invoice_version: int


class SettleRequest(Strict):
    outcome: Literal["SETTLED", "FAILED"] = "SETTLED"


class BankChangeCreate(Strict):
    institution: str
    transit: str
    account: str
    request_channel: Literal["email_request", "phone_inbound", "vendor_portal", "letter"]
    evidence_ref: str | None = None


class VerificationRequest(Strict):
    expected_row_version: int | None = None
    trusted_contact_id: str | None = None
    method: Literal["phone_callback_to_contact_on_file", "video_call_to_contact_on_file", "in_person_meeting"]
    occurred_at: str
    outcome: Literal["CONFIRMED", "DENIED"]
    notes: str
    evidence_ref: str


class AuthorizeRouteRequest(Strict):
    expected_row_version: int | None = None
    notes: str


class CaseActionRequest(Strict):
    action_type: Literal["note", "request_information", "escalate", "document_decision"]
    notes: str | None = None
    decision: Literal["reject_invoice", "keep_on_hold"] | None = None
    expected_row_version: int | None = None


class AuthorizationRequestBody(Strict):
    expected_invoice_version: int
    notes: str | None = None


class OnboardRequest(Strict):
    legal_name: str
    category: str | None = None
    country: str = "CA"
    province: str | None = None
    gst_hst_number: str | None = None
    contact_email: str | None = None


class ActivateRequest(Strict):
    notes: str


# ------------------------------------------------------------------ virtual-card rerouting (§6.2)
class CardRouteCreate(Strict):
    merchant_reference: str = Field(..., description="Merchant reference supplied by the vendor in writing. Never "
                                    "derived from a card-transaction descriptor.")
    evidence_ref: str
    notes: str


class CardRouteVerificationRequest(VerificationRequest):
    """Independent callback to a trusted contact on file before the route was registered."""


class CardRouteOut(BaseModel):
    id: str
    vendor_id: str
    method: Literal["CARD"]
    status: str
    merchant_reference_masked: str | None
    provenance: str
    registered_by: str | None
    registered_at: str | None
    verified_by: str | None
    verified_at: str | None
    verification: dict[str, Any]
    row_version: int
    simulated: bool = True
    allowed_actions: list[str]


class MethodChangeCreate(VersionedRequest):
    to_method: Literal["CARD"] = "CARD"
    reason: str


class MethodChangeDecisionRequest(Strict):
    expected_row_version: int | None = None
    decision: Literal["AUTHORIZED", "DECLINED"]
    notes: str


class MethodChangeOut(BaseModel):
    id: str
    invoice_id: str
    invoice_version: int
    vendor_id: str
    from_method: str
    to_method: str
    route_id: str
    state: str
    requested_by: str
    requested_at: str
    reason: str
    gate_snapshot: dict[str, Any]
    supporting_card_history: dict[str, Any]
    decided_by: str | None
    decided_at: str | None
    decision_notes: str | None
    row_version: int
    applies_to_current_version: bool
    allowed_actions: list[str]
