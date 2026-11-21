/**
 * Typed domain models for Brim Sentinel (PRD v1.4).
 * They mirror what the FastAPI backend will return. Mock services implement the
 * same contracts, so the UI never depends on where data comes from.
 * Money is always integer minor units (cents) — never floats (PRD §8).
 */

export type Currency = "CAD" | "USD";
export type RiskBand = "low" | "medium" | "high";
export type DocLanguage = "en" | "fr";
export type DocumentKind = "invoice" | "credit_note" | "statement" | "payment_inquiry" | "non_ap";
export type IntakeChannel = "email" | "upload";

/** Workflow states (PRD §9), plus the intake-only "processing" state. */
export type InvoiceStatus =
  | "processing"
  | "needs_review"
  | "on_hold"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "released"
  | "settled"
  | "failed"
  | "rejected"
  | "credit_recorded"
  | "non_payable";

export type FindingCode =
  | "BANK_CHANGE_UNVERIFIED"
  | "UNKNOWN_VENDOR"
  | "VENDOR_PENDING_REVIEW"
  | "DUPLICATE_VENDOR_IDENTITY"
  | "DUPLICATE_CANDIDATE"
  | "CARD_PAID_DUPLICATE"
  | "AMOUNT_UNUSUAL"
  | "FUEL_SURCHARGE_UNUSUAL"
  | "PO_MISSING"
  | "TAX_MISMATCH"
  | "LOW_CODING_CONFIDENCE"
  | "MISSING_ATTACHMENT"
  | "EXTRACTION_UNREADABLE"
  | "NO_ELIGIBLE_RELEASER";

export interface Finding {
  code: FindingCode;
  severity: RiskBand;
  /** Hard holds block payment until resolved by authorized people. */
  blocking: boolean;
  /** Plain-language headline, e.g. "Bank account changed and not yet verified". */
  title: string;
  whyItMatters: string;
  whatHappensNext: string;
  evidenceIds: string[];
}

export type RoleId =
  | "requester"
  | "ap_clerk"
  | "dept_approver"
  | "finance_manager"
  | "controller"
  | "cfo"
  | "auditor";

export type ApprovalStepStatus = "approved" | "pending" | "waiting" | "rejected";

export interface ApprovalStep {
  order: number;
  role: RoleId;
  userId: string;
  userName: string;
  /** Policy rules that required this step, e.g. ["P02", "P06"]. */
  rules: string[];
  status: ApprovalStepStatus;
  /** Set when a delegate acts for someone on leave (P08). */
  actingFor?: string;
  note?: string;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPriceMinor: number;
}

export type PaymentMethod = "eft" | "brim_virtual_card";

export interface Invoice {
  id: string;
  /** Supplier's own invoice number; null when unreadable. */
  number: string | null;
  kind: DocumentKind;
  supplierId: string;
  supplierName: string;
  /** Total in minor units; null when not extracted (never guessed). */
  totalMinor: number | null;
  subtotalMinor: number | null;
  taxes: { label: string; amountMinor: number }[];
  currency: Currency;
  /** Stored FX rate to CAD at invoice date (USD only). */
  fxToCad?: number;
  issueDate: string | null;
  dueDate: string | null;
  receivedAt: string;
  status: InvoiceStatus;
  risk: RiskBand;
  language: DocLanguage;
  scanned: boolean;
  channel: IntakeChannel;
  sourceRef: string;
  fileName: string | null;
  department: string;
  requesterId: string;
  poNumber?: string;
  suggestedGl?: { code: string; name: string; confidence: number };
  lineItems: LineItem[];
  findings: Finding[];
  approvalChain: ApprovalStep[];
  scheduledFor?: string;
  paymentMethod?: PaymentMethod;
  /** Client-side upload simulation only. */
  processingStartedAt?: number;
}

export type VendorStatus = "active" | "pending_review" | "unknown" | "inactive";

export interface User {
  id: string;
  name: string;
  initials: string;
  title: string;
  role: RoleId;
  department: string;
}

export type PrimaryActionKind =
  | "processing"
  | "request_document"
  | "fix_extraction"
  | "review"
  | "review_bank_details"
  | "resolve_issue"
  | "approve"
  | "view_approval"
  | "view_payment"
  | "view_record";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  label: string;
  /** Visual weight; exactly one primary action per task. */
  emphasis: "primary" | "secondary" | "quiet";
  disabled?: boolean;
}

/** A row on Home: one task, one plain-language status, one primary action. */
export interface InvoiceTask {
  invoice: Invoice;
  plainStatus: string;
  owner: string;
  action: PrimaryAction;
}

export interface HomeSummary {
  needsAttention: InvoiceTask[];
  readyForApproval: InvoiceTask[];
  upcomingPayments: InvoiceTask[];
  metrics: {
    processed: number;
    needsReview: number;
    onHold: number;
    upcomingPayments: number;
  };
}

export type InvoiceStatusFilter =
  | "all"
  | "attention"
  | "processing"
  | "approval"
  | "payment"
  | "done";

export interface InvoiceListParams {
  q?: string;
  status?: InvoiceStatusFilter;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  invoiceId?: string;
  tone: "critical" | "warning" | "info" | "success";
}

export interface UploadInvoiceInput {
  fileName: string;
  sizeBytes: number;
}

export type CheckResult = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";

export interface ValidationCheck {
  name: string;
  result: CheckResult;
  note: string;
}

export interface InvoiceDetail extends InvoiceTask {
  checks: ValidationCheck[];
  eligibleReleaser: string | null;
  amountCadMinor: number | null;
}
