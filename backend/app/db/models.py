"""SQLAlchemy 2 models. Money columns are integer minor units (`*_minor`) with explicit currency.
FX rates are stored as decimal strings. Every invoice has immutable numbered versions; findings,
coding, approvals and payments reference (invoice_id, version)."""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


# ---------------------------------------------------------------- master data
class Department(Base):
    __tablename__ = "departments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str]
    cost_centre: Mapped[str | None]
    annual_budget_minor: Mapped[int | None]
    manager_user_id: Mapped[str | None]


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    full_name: Mapped[str]
    email: Mapped[str | None]
    title: Mapped[str]
    department_id: Mapped[str | None]
    manager_id: Mapped[str | None]
    role: Mapped[str]  # dataset roles + 'service_ai'
    approval_limit_minor: Mapped[int] = mapped_column(Integer, default=0)
    work_province: Mapped[str | None]
    status: Mapped[str]  # active | on_leave | terminated
    status_since: Mapped[str | None]
    delegate_user_id: Mapped[str | None]
    kind: Mapped[str] = mapped_column(String, default="human")  # human | service


class Vendor(Base):
    __tablename__ = "vendors"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    legal_name: Mapped[str]
    category: Mapped[str | None]
    default_gl_account: Mapped[str | None]
    address: Mapped[str | None]
    province_or_state: Mapped[str | None]
    country: Mapped[str | None]
    gst_hst_number: Mapped[str | None]
    qst_number: Mapped[str | None]
    payment_terms_days: Mapped[int | None]
    preferred_payment_method: Mapped[str | None]
    accepts_card_payment: Mapped[bool] = mapped_column(Boolean, default=False)
    bank_institution: Mapped[str | None]
    bank_transit: Mapped[str | None]
    bank_account: Mapped[str | None]  # synthetic; never returned unmasked by the API
    bank_details_updated_at: Mapped[str | None]
    ap_contact_email: Mapped[str | None]
    requires_po: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str]  # active | pending_review | on_hold | inactive | new
    onboarded_at: Mapped[str | None]
    source: Mapped[str] = mapped_column(String, default="dataset")


class VendorContact(Base):
    """Trusted contacts on file. Only contacts established before a bank-change request may be
    used for independent callback verification."""
    __tablename__ = "vendor_contacts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"))
    channel: Mapped[str]  # email | phone
    value: Mapped[str]
    source: Mapped[str]  # vendor_master
    established_at: Mapped[str]


class VendorBankChange(Base):
    __tablename__ = "vendor_bank_changes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    requested_at: Mapped[str]
    requested_by_user_id: Mapped[str | None]
    request_channel: Mapped[str]
    old_account_last4: Mapped[str | None]
    new_account_last4: Mapped[str | None]
    new_route_id: Mapped[str | None]
    # REQUESTED -> PENDING_INDEPENDENT_VERIFICATION -> VERIFICATION_RECORDED ->
    # PENDING_ROUTE_AUTHORIZATION -> AUTHORIZED -> REVALIDATION_REQUIRED -> CLOSED | REJECTED
    state: Mapped[str]
    source: Mapped[str] = mapped_column(String, default="dataset")
    verified_by_callback_source: Mapped[bool] = mapped_column(Boolean, default=False)
    verifier_id: Mapped[str | None]
    trusted_contact_id: Mapped[str | None]
    verification_method: Mapped[str | None]
    verification_occurred_at: Mapped[str | None]
    verification_notes: Mapped[str | None]
    verification_evidence_ref: Mapped[str | None]
    verification_outcome: Mapped[str | None]
    authorized_by_id: Mapped[str | None]
    authorized_at: Mapped[str | None]
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class PaymentRoute(Base):
    """VerifiedPaymentRoute registry. A route is only payable when status == VERIFIED."""
    __tablename__ = "payment_routes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    method: Mapped[str]  # EFT | CARD | CHEQUE
    account_last4: Mapped[str | None]
    account_fingerprint: Mapped[str | None]
    status: Mapped[str]  # VERIFIED | UNVERIFIED | REVOKED
    provenance: Mapped[str]
    verified_at: Mapped[str | None]
    bank_change_id: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    # CARD routes registered in the app: a human-entered merchant reference (never inferred
    # from a card descriptor) and an independent verifier distinct from the registrant.
    merchant_reference: Mapped[str | None] = mapped_column(String, default=None)
    registered_by: Mapped[str | None] = mapped_column(String, default=None)
    registered_at: Mapped[str | None] = mapped_column(String, default=None)
    verified_by: Mapped[str | None] = mapped_column(String, default=None)
    verification: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class PaymentMethodChange(Base):
    """EFT → simulated Brim virtual-card method change for ONE invoice version (PRD §6.2).

    REQUESTED → AUTHORIZED | DECLINED; an AUTHORIZED change applies only while the invoice
    version it is bound to is current (a material edit makes it SUPERSEDED). Authorization is a
    finance manager who is neither the requester nor the card-route registrant/verifier."""
    __tablename__ = "payment_method_changes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id"), index=True)
    invoice_version: Mapped[int]
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"))
    from_method: Mapped[str]
    to_method: Mapped[str]
    route_id: Mapped[str]
    state: Mapped[str]  # REQUESTED | AUTHORIZED | DECLINED | SUPERSEDED
    requested_by: Mapped[str]
    requested_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    reason: Mapped[str]
    gate_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    supporting_card_history: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    decided_by: Mapped[str | None] = mapped_column(String, default=None)
    decided_at: Mapped[dt.datetime | None] = mapped_column(default=None)
    decision_notes: Mapped[str | None] = mapped_column(Text, default=None)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class Contract(Base):
    __tablename__ = "contracts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    vendor_id: Mapped[str] = mapped_column(index=True)
    description: Mapped[str | None]
    billing_type: Mapped[str | None]
    monthly_fee_minor: Mapped[int | None]
    currency: Mapped[str | None]
    hourly_rate_cap_minor: Mapped[int | None]
    fuel_surcharge_cap_pct: Mapped[str | None]
    not_to_exceed_monthly_minor: Mapped[int | None]
    start_date: Mapped[str | None]
    end_date: Mapped[str | None]
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str | None]


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    vendor_id: Mapped[str] = mapped_column(index=True)
    department_id: Mapped[str | None]
    requester_user_id: Mapped[str | None]
    issue_date: Mapped[str | None]
    description: Mapped[str | None]
    total_minor: Mapped[int]
    currency: Mapped[str]
    status: Mapped[str]
    approved_by: Mapped[str | None]


class GLAccount(Base):
    __tablename__ = "gl_accounts"
    account_number: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str]
    account_type: Mapped[str | None]
    notes: Mapped[str | None]


class TaxCode(Base):
    __tablename__ = "tax_codes"
    code: Mapped[str] = mapped_column(String, primary_key=True)
    description: Mapped[str]
    rate: Mapped[str]
    applies_to: Mapped[str | None]
    recoverable: Mapped[str | None]
    gl_account: Mapped[str | None]


class FxRate(Base):
    __tablename__ = "fx_rates"
    date: Mapped[str] = mapped_column(String, primary_key=True)
    usd_to_cad: Mapped[str]


class ApprovalPolicy(Base):
    __tablename__ = "approval_policies"
    rule_id: Mapped[str] = mapped_column(String, primary_key=True)
    rule_type: Mapped[str]
    condition: Mapped[str]
    required: Mapped[str]
    notes: Mapped[str | None]


class PolicySetting(Base):
    """Editable approval policy (one row per policy name). Versioned for optimistic concurrency;
    every change is also an audit event with before/after values."""
    __tablename__ = "policy_settings"
    id: Mapped[str] = mapped_column(String, primary_key=True)  # "approval"
    values: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[str | None]
    updated_at: Mapped[dt.datetime | None]
    reason: Mapped[str | None] = mapped_column(Text)


class CardTransaction(Base):
    __tablename__ = "card_transactions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    card_id: Mapped[str | None]
    cardholder_user_id: Mapped[str | None]
    posted_date: Mapped[str] = mapped_column(index=True)
    merchant_descriptor: Mapped[str]
    mcc: Mapped[str | None]
    amount_minor: Mapped[int]
    currency: Mapped[str]
    amount_cad_minor: Mapped[int]
    source: Mapped[str | None]
    receipt_attached: Mapped[bool] = mapped_column(Boolean, default=False)
    memo: Mapped[str | None]


# ---------------------------------------------------------------- intake
class EmailMessage(Base):
    __tablename__ = "email_messages"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    from_name: Mapped[str | None]
    from_address: Mapped[str | None]
    to_address: Mapped[str | None]
    subject: Mapped[str | None]
    received_at: Mapped[str | None]
    body: Mapped[str | None] = mapped_column(Text)
    attachments: Mapped[list[Any]] = mapped_column(JSON, default=list)
    classification: Mapped[str]
    classification_reason: Mapped[str | None]
    imported_at: Mapped[dt.datetime] = mapped_column(default=utcnow)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("source_ref", "sha256", name="uq_document_source_hash"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_ref: Mapped[str]  # email id or 'upload:<actor>'
    filename: Mapped[str]
    sha256: Mapped[str] = mapped_column(index=True)
    size_bytes: Mapped[int]
    mime_type: Mapped[str]
    storage_path: Mapped[str]
    text_layer: Mapped[str | None] = mapped_column(Text)
    extraction_provenance: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)


class IntakeItem(Base):
    """Every classified email/attachment outcome, including non-payable and missing-document items."""
    __tablename__ = "intake_items"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email_id: Mapped[str | None] = mapped_column(index=True)
    document_id: Mapped[str | None]
    item_type: Mapped[str]  # invoice | credit_note | statement | payment_inquiry | non_ap | missing_document | unreadable
    payable: Mapped[bool] = mapped_column(Boolean, default=False)
    invoice_id: Mapped[str | None]
    status: Mapped[str]  # OPEN | DRAFT_CREATED | CLOSED
    note: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)


# ---------------------------------------------------------------- invoices
class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_kind: Mapped[str]  # historical_ledger | email_intake | upload
    kind: Mapped[str] = mapped_column(String, default="invoice")  # invoice | credit_note
    email_id: Mapped[str | None]
    document_id: Mapped[str | None]
    vendor_id: Mapped[str | None] = mapped_column(index=True)
    lifecycle_state: Mapped[str] = mapped_column(index=True)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    row_version: Mapped[int] = mapped_column(Integer, default=1)
    historical_status: Mapped[str | None]
    risk_band: Mapped[str | None]
    risk_score: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class InvoiceVersion(Base):
    __tablename__ = "invoice_versions"
    __table_args__ = (UniqueConstraint("invoice_id", "version", name="uq_invoice_version"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id"), index=True)
    version: Mapped[int]
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    created_by: Mapped[str]
    reason: Mapped[str]
    provenance: Mapped[str]  # pdf_text | ocr | vision | manual | demo_fixture | dataset_csv
    vendor_id: Mapped[str | None]
    vendor_name_raw: Mapped[str | None]
    vendor_tax_id: Mapped[str | None]
    vendor_match: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    invoice_number_raw: Mapped[str | None]
    invoice_number_norm: Mapped[str | None] = mapped_column(index=True)
    document_type: Mapped[str | None]
    invoice_date: Mapped[str | None]
    due_date: Mapped[str | None]
    received_date: Mapped[str | None]
    terms_raw: Mapped[str | None]
    currency: Mapped[str | None]
    subtotal_minor: Mapped[int | None]
    taxes: Mapped[list[Any]] = mapped_column(JSON, default=list)
    total_minor: Mapped[int | None]
    fx_rate: Mapped[str | None]
    fx_date: Mapped[str | None]
    amount_cad_minor: Mapped[int | None]
    remit: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    ship_to_province: Mapped[str | None]
    po_number: Mapped[str | None]
    contract_id: Mapped[str | None]
    department_id: Mapped[str | None]
    department_source: Mapped[str | None]
    requester_id: Mapped[str | None]
    requester_source: Mapped[str | None]
    language: Mapped[str | None]
    uncertain_fields: Mapped[list[Any]] = mapped_column(JSON, default=list)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    coding_confirmed_by: Mapped[str | None]


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    __table_args__ = (UniqueConstraint("invoice_id", "version", "line_no", name="uq_invoice_line"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id"), index=True)
    version: Mapped[int]
    line_no: Mapped[int]
    description: Mapped[str]
    quantity: Mapped[str]
    unit_price_minor: Mapped[int | None]
    amount_minor: Mapped[int | None]
    line_type: Mapped[str | None]
    gl_account: Mapped[str | None]
    department_id: Mapped[str | None]
    coding_confidence: Mapped[str | None]
    coding_method: Mapped[str | None]
    coding_status: Mapped[str | None]  # SUGGESTED | NEEDS_REVIEW | CONFIRMED | OVERRIDDEN | HISTORICAL
    coding_detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ValidationFinding(Base):
    __tablename__ = "validation_findings"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id"), index=True)
    version: Mapped[int]
    run_no: Mapped[int]
    check: Mapped[str]
    code: Mapped[str]
    result: Mapped[str]  # PASS | FAIL | UNKNOWN | NOT_APPLICABLE
    severity: Mapped[str]  # info | low | medium | high | critical
    blocking: Mapped[bool] = mapped_column(Boolean, default=False)
    title: Mapped[str]
    rationale: Mapped[str] = mapped_column(Text)
    why_it_matters: Mapped[str | None] = mapped_column(Text)
    next_action: Mapped[str | None]
    policy_ids: Mapped[list[Any]] = mapped_column(JSON, default=list)
    evidence: Mapped[list[Any]] = mapped_column(JSON, default=list)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    dismissed_by: Mapped[str | None]
    dismissal_reason: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)


class FindingDismissal(Base):
    """Authorized, reasoned dismissal of a (non-hard) finding for a specific invoice version.
    Survives revalidation of the same version; a new version requires a new decision."""
    __tablename__ = "finding_dismissals"
    __table_args__ = (UniqueConstraint("invoice_id", "version", "code", "subject", name="uq_dismissal"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_id: Mapped[str] = mapped_column(index=True)
    version: Mapped[int]
    code: Mapped[str]
    subject: Mapped[str]
    actor_id: Mapped[str]
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)


class DuplicateCandidate(Base):
    __tablename__ = "duplicate_candidates"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    invoice_id: Mapped[str] = mapped_column(index=True)
    version: Mapped[int]
    run_no: Mapped[int]
    match_type: Mapped[str]  # EXACT | NORMALIZED_NUMBER | ALIAS_VENDOR | NEAR | CARD_PAID
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    score: Mapped[int]
    matched_invoice_id: Mapped[str | None]
    matched_card_txn_id: Mapped[str | None]
    reasons: Mapped[list[Any]] = mapped_column(JSON, default=list)


class AnomalyResult(Base):
    __tablename__ = "anomaly_results"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_id: Mapped[str] = mapped_column(index=True)
    version: Mapped[int]
    method_version: Mapped[str]
    as_of: Mapped[str]
    band: Mapped[str]
    score: Mapped[str]
    status: Mapped[str]  # SCORED | INSUFFICIENT_HISTORY | NOT_SCORED
    inputs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    signals: Mapped[list[Any]] = mapped_column(JSON, default=list)
    computed_at: Mapped[dt.datetime] = mapped_column(default=utcnow)


# ---------------------------------------------------------------- approvals
class ApprovalStep(Base):
    __tablename__ = "approval_steps"
    __table_args__ = (UniqueConstraint("invoice_id", "version", "step_key", name="uq_step"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    invoice_id: Mapped[str] = mapped_column(index=True)
    version: Mapped[int]
    step_index: Mapped[int]
    step_key: Mapped[str]  # dept_manager | finance_manager | controller_admin | cfo
    required_role: Mapped[str]
    policy_ids: Mapped[list[Any]] = mapped_column(JSON, default=list)
    authority_ceiling_minor: Mapped[int]
    assigned_actor_id: Mapped[str | None]
    delegated_from_id: Mapped[str | None]
    escalation_reason: Mapped[str | None] = mapped_column(Text)


class ApprovalDecision(Base):
    __tablename__ = "approval_decisions"
    __table_args__ = (UniqueConstraint("invoice_id", "version", "step_key", name="uq_decision_step"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    invoice_id: Mapped[str] = mapped_column(index=True)
    version: Mapped[int]
    step_key: Mapped[str]
    actor_id: Mapped[str]
    delegated_from_id: Mapped[str | None]
    decision: Mapped[str]  # APPROVED | REJECTED
    reason: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    source: Mapped[str] = mapped_column(String, default="app")  # app | historical_import


# ---------------------------------------------------------------- resolution
class ResolutionCase(Base):
    __tablename__ = "resolution_cases"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    invoice_id: Mapped[str] = mapped_column(index=True)
    invoice_version: Mapped[int]
    case_type: Mapped[str] = mapped_column(index=True)
    state: Mapped[str]
    severity: Mapped[str]
    owner_role: Mapped[str]
    owner_id: Mapped[str | None]
    finding_ids: Mapped[list[Any]] = mapped_column(JSON, default=list)
    bank_change_id: Mapped[str | None]
    closure_outcome: Mapped[str | None]
    row_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class ResolutionAction(Base):
    __tablename__ = "resolution_actions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    case_id: Mapped[str] = mapped_column(index=True)
    action_type: Mapped[str]
    status: Mapped[str]  # PROPOSED | REQUESTED | COMPLETED | REJECTED
    actor_id: Mapped[str | None]
    notes: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)


# ---------------------------------------------------------------- payments
class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        # At most one live (non-cancelled) payment per invoice version → at most one release.
        Index(
            "uq_live_payment_per_version",
            "invoice_id",
            "invoice_version",
            unique=True,
            sqlite_where=text("source = 'simulation' AND state NOT IN ('CANCELLED', 'FAILED')"),
        ),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    invoice_id: Mapped[str] = mapped_column(index=True)
    invoice_version: Mapped[int]
    vendor_id: Mapped[str | None]
    method: Mapped[str]
    route_id: Mapped[str | None]
    currency: Mapped[str]
    amount_minor: Mapped[int]
    amount_cad_minor: Mapped[int]
    state: Mapped[str]  # SCHEDULED | RELEASED | SETTLED | FAILED | CANCELLED | HISTORICAL
    simulation: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String, default="simulation")
    prepared_by: Mapped[str | None]
    released_by: Mapped[str | None]
    reference: Mapped[str | None]
    scheduled_date: Mapped[str | None]
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)
    released_at: Mapped[dt.datetime | None]
    settled_at: Mapped[dt.datetime | None]
    idempotency_key_hash: Mapped[str | None]
    historical_status: Mapped[str | None]


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("actor_id", "operation", "key", name="uq_idempotency"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[str]
    operation: Mapped[str]
    key: Mapped[str]
    request_hash: Mapped[str]
    response: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(default=utcnow)


# ---------------------------------------------------------------- audit
class AuditEvent(Base):
    """Append-only. No update/delete path exists; an ORM guard rejects modifications.
    Hash-chained (tamper-evident, not immutable without an external anchor)."""
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurred_at: Mapped[dt.datetime] = mapped_column(default=utcnow, index=True)
    actor_id: Mapped[str | None] = mapped_column(index=True)
    actor_kind: Mapped[str]  # human | service | system
    action: Mapped[str]
    object_type: Mapped[str]
    object_id: Mapped[str] = mapped_column(index=True)
    object_version: Mapped[int | None]
    invoice_id: Mapped[str | None] = mapped_column(index=True)
    result: Mapped[str]  # SUCCESS | DENIED | BLOCKED | INFO
    policy_ids: Mapped[list[Any]] = mapped_column(JSON, default=list)
    evidence: Mapped[list[Any]] = mapped_column(JSON, default=list)
    before_state: Mapped[str | None]
    after_state: Mapped[str | None]
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    correlation_id: Mapped[str | None]
    prev_hash: Mapped[str | None]
    hash: Mapped[str]
