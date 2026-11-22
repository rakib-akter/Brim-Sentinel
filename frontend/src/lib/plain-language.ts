/**
 * Plain-language labels for every internal code the backend returns.
 *
 * Customers should never see state machine names, rule codes, lookup function names or raw
 * evidence objects. Screens call these helpers instead of printing codes. Unknown codes fall back
 * to a readable sentence-case version, so a new backend value never shows up as SHOUTING_CASE.
 */

const STATUS: Record<string, string> = {
  // Invoice lifecycle
  RECEIVED: "Received",
  DRAFT: "Draft",
  EXTRACTED: "Details read",
  CODED: "Coded",
  VALIDATED: "Checks complete",
  ON_HOLD: "Payment paused",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  SCHEDULED: "Payment scheduled",
  RELEASED: "Payment released (simulated)",
  SETTLED: "Paid (simulated)",
  FAILED: "Payment failed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  CREDIT_RECORDED: "Credit recorded",
  // Resolution cases
  OPEN: "Open",
  INVESTIGATING: "Being investigated",
  AWAITING_INFORMATION: "Waiting for information",
  AWAITING_VERIFICATION: "Waiting for supplier verification",
  AWAITING_AUTHORIZATION: "Waiting for authorization",
  READY_FOR_REVALIDATION: "Ready to re-check",
  RESOLVED: "Resolved",
  // Bank changes and payment routes
  REQUESTED: "Requested",
  PENDING_INDEPENDENT_VERIFICATION: "Waiting for supplier verification",
  VERIFICATION_RECORDED: "Supplier verified",
  PENDING_ROUTE_AUTHORIZATION: "Waiting for finance authorization",
  AUTHORIZED: "Authorized",
  REVALIDATION_REQUIRED: "Needs re-check",
  CLOSED: "Closed",
  VERIFIED: "Verified",
  SUPERSEDED: "Replaced by a newer version",
  EXPIRED: "Expired",
  DECLINED: "Declined",
  CONFIRMED: "Confirmed",
  DENIED: "Denied",
  // Steps and results
  PENDING: "To do",
  WAITING: "Waiting",
  DONE: "Done",
  COMPLETED: "Done",
  PROPOSED: "Proposed",
  SKIPPED: "Skipped",
  SUCCESS: "Done",
  INFO: "Recorded",
  BLOCKED: "Blocked",
  PASS: "Passed",
  FAIL: "Problem found",
  UNKNOWN: "Couldn't be confirmed",
  NOT_APPLICABLE: "Not applicable",
  // Vendors
  ACTIVE: "Active",
  PENDING_REVIEW: "Pending review",
  INACTIVE: "Inactive",
  // Wizard steps and failures
  REVIEW: "Review",
  VERIFY_SUPPLIER: "Verify supplier",
  CHOOSE_ROUTE: "Choose payment route",
  REQUEST_AUTHORIZATION: "Request authorization",
  VERIFIED_CARD_ROUTE_UNAVAILABLE: "No verified card route",
  VERIFICATION_METHOD_INVALID: "Verification method not accepted",
  // Channels, methods, proposals and case actions
  EMAIL_REQUEST: "Email request",
  PHONE_INBOUND: "Inbound phone call",
  VENDOR_PORTAL: "Supplier portal",
  LETTER: "Letter",
  PHONE_CALLBACK_TO_CONTACT_ON_FILE: "Phone callback to contact on file",
  VIDEO_CALL_TO_CONTACT_ON_FILE: "Video call to contact on file",
  IN_PERSON_MEETING: "In-person meeting",
  EFT: "EFT",
  CARD: "Brim virtual card",
  CHEQUE: "Cheque",
  TRUSTED_CALLBACK: "Call the supplier on a number already on file",
  REQUEST_CORRECTED_INVOICE: "Ask the supplier for a corrected invoice",
  INSPECT_CARD_RECEIPT: "Check the Brim card charge and receipt",
  VENDOR_ONBOARDING: "Onboard and verify the supplier",
  ESCALATE_TO_CONTROLLER: "Escalate to the controller",
  CONFIRM_CODING: "Confirm the accounting codes",
  NOTE: "Note",
  REQUEST_INFORMATION: "Request for information",
  ESCALATE: "Escalation",
  DOCUMENT_DECISION: "Documented decision",
  AUTHORIZATION_REQUEST: "Authorization requested",
  KEEP_ON_HOLD: "Keep payment paused",
  REJECT_INVOICE: "Reject invoice",
  // Extraction provenance and contact sources
  PDF_TEXT: "read from the PDF text",
  OCR: "read from the scanned image (OCR)",
  VISION: "read by AI vision",
  MANUAL: "entered by a person",
  DEMO_FIXTURE: "demo transcription (clearly labelled, not live OCR)",
  VENDOR_MASTER: "supplier record",
  // Roles
  AP_CLERK: "AP team",
  APPROVER: "Department approver",
  DEPT_MANAGER: "Department manager",
  FINANCE_MANAGER: "Finance manager",
  CONTROLLER_ADMIN: "Controller",
  CONTROLLER: "Controller",
  CFO: "CFO",
  AUDITOR: "Auditor",
  EMPLOYEE: "Requester",
};

const POLICY: Record<string, string> = {
  P01: "invoices up to CAD 10,000 need the department manager",
  P02: "over CAD 10,000 also needs the finance manager",
  P03: "over CAD 50,000 also needs the controller",
  P04: "over CAD 250,000 also needs the CFO",
  P05: "new or pending suppliers need the finance manager",
  P06: "legal suppliers need the finance manager",
  P07: "nobody approves their own invoice",
  P08: "an approver on leave is covered by their delegate",
  P09: "the finance manager can release up to CAD 100,000",
  P10: "only the controller can release over CAD 100,000",
  P11: "whoever approved an invoice can't release its payment",
  P12: "invoices must fit within the purchase order's remaining balance",
  P13: "suppliers that require a purchase order must have one",
};

const EVIDENCE_TYPE: Record<string, string> = {
  document_field: "Invoice document",
  document: "Invoice document",
  invoice: "Invoice",
  invoice_line: "Invoice line",
  vendor: "Supplier record",
  vendor_master: "Supplier record",
  bank_change: "Bank change request",
  payment_route: "Payment route",
  route_evidence: "Payment route evidence",
  payment_method_change: "Payment method change",
  contract: "Contract",
  purchase_order: "Purchase order",
  card_transaction: "Brim card charge",
  fx_rates: "Exchange rate",
  user: "Person",
  approval: "Approval",
  finding: "Check result",
  finding_run: "Check run",
};

const LOOKUP: Record<string, string> = {
  get_invoice_evidence: "Read the invoice and its check results",
  get_vendor_profile: "Read the supplier record",
  get_bank_changes: "Read the bank change history",
  get_contract_terms: "Read the contract terms",
  find_related_invoices: "Looked for other invoices from this supplier",
  get_card_transactions: "Looked for matching Brim card charges",
  get_approval_history: "Read the approval history",
};

function sentence(code: string): string {
  const words = code
    .replaceAll(/[_.]+/g, " ")
    .trim()
    .toLowerCase()
    .replaceAll(/\b(po|gl|id|fx|eft|cad|usd|gst|hst|pst|qst|ocr|pdf|ap)\b/g, (w) =>
      w.toUpperCase(),
    );
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A friendly label for any status, state, role, channel or action code. */
export function plain(code: string | null | undefined): string {
  if (!code) return "";
  return STATUS[code.toUpperCase()] ?? sentence(code);
}

/** "P02" → "Rule P02: over CAD 10,000 also needs the finance manager". */
export function policyLabel(id: string): string {
  const text = POLICY[id];
  return text ? `Rule ${id}: ${text}` : `Rule ${id}`;
}

/** One readable line for an evidence reference (object from the API, or a string). */
export function evidenceLabel(item: unknown): string {
  if (typeof item === "string") return lookupLabel(item);
  if (!item || typeof item !== "object") return String(item ?? "");
  const e = item as Record<string, unknown>;
  const kind =
    typeof e["type"] === "string" ? (EVIDENCE_TYPE[e["type"]] ?? sentence(e["type"])) : "Evidence";
  const label = typeof e["label"] === "string" ? e["label"] : null;
  const ref = e["ref"] ?? e["id"];
  if (label && typeof ref === "string" && /^[a-z][a-z0-9_]*$/.test(ref))
    return `${kind} · ${sentence(ref)}: ${label}`;
  if (label) return `${kind}: ${label}`;
  return ref != null && ref !== "" ? `${kind} ${String(ref)}` : kind;
}

/** "get_bank_changes#2" → "Read the bank change history". */
export function lookupLabel(ref: string): string {
  const tool = ref.split("#")[0] ?? ref;
  return LOOKUP[tool] ?? sentence(tool);
}

/** Whether a result code is worth showing next to an event (routine outcomes are hidden). */
export function isNotableResult(result: string | null | undefined): boolean {
  return !!result && !["SUCCESS", "INFO"].includes(result.toUpperCase());
}

/** Readable "Label: value" lines for a small key/value record (e.g. a case action's details). */
export function describeData(data: Record<string, unknown>): string[] {
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      const value =
        typeof v === "string"
          ? /^[A-Z][A-Z_]+$/.test(v)
            ? plain(v)
            : v
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : Array.isArray(v)
              ? v.map((x) => (typeof x === "object" ? evidenceLabel(x) : String(x))).join(", ")
              : evidenceLabel(v);
      return `${sentence(k)}: ${value}`;
    });
}

const ACTION: Record<string, string> = {
  "invoice.received": "Invoice received",
  "invoice.extracted": "Invoice details read",
  "invoice.transition": "Invoice status changed",
  "invoice.validated": "Checks ran",
  "invoice.version_created": "Invoice corrected (new version)",
  "approvals.invalidated": "Approvals reset after a change",
  "approval.approved": "Approved",
  "approval.rejected": "Rejected",
  "case.opened": "Case opened",
  "case.resolved": "Case resolved",
  "case.authorization_requested": "Authorization requested",
  "payment.scheduled": "Payment scheduled (simulated)",
  "payment.released": "Payment released (simulated)",
  "payment.simulated_settled": "Payment settled (simulated)",
  "payment.release_replayed": "Repeat release request (no second payment)",
  "bank_change.verification_recorded": "Supplier verification recorded",
  "bank_change.transition": "Bank change status changed",
  "finding.dismissed": "Check dismissed with a reason",
  "coding.decision": "Accounting codes confirmed or corrected",
  "investigation.lookup": "Sentinel looked up evidence",
  "investigation.model_call": "Sentinel AI read the evidence",
  "investigation.completed": "Investigation summary produced",
};

/** Readable name for an audit action such as "payment.released". */
export function actionLabel(action: string): string {
  return ACTION[action] ?? sentence(action);
}

/** Where an evidence reference can be opened in the app, if anywhere. */
export type EvidenceTarget =
  { kind: "invoice"; invoiceId: string } | { kind: "vendor"; vendorId: string } | null;

const INVOICE_ID = /^(AP-\d+|IN-[A-Z0-9-]+)$/;
const VENDOR_ID = /^V\d{3,}$/;

export function evidenceTarget(item: unknown): EvidenceTarget {
  if (typeof item === "string") {
    return INVOICE_ID.test(item) ? { kind: "invoice", invoiceId: item } : null;
  }
  if (!item || typeof item !== "object") return null;
  const e = item as Record<string, unknown>;
  const ref = typeof e["ref"] === "string" ? e["ref"] : typeof e["id"] === "string" ? e["id"] : "";
  const type = typeof e["type"] === "string" ? e["type"] : "";
  if ((type === "vendor" || type === "vendor_master") && VENDOR_ID.test(ref))
    return { kind: "vendor", vendorId: ref };
  if (type === "invoice" && INVOICE_ID.test(ref)) return { kind: "invoice", invoiceId: ref };
  for (const key of ["invoice_id", "matched_invoice_id"]) {
    const v = e[key];
    if (typeof v === "string" && INVOICE_ID.test(v)) return { kind: "invoice", invoiceId: v };
  }
  if (typeof e["vendor_id"] === "string" && VENDOR_ID.test(e["vendor_id"]))
    return { kind: "vendor", vendorId: e["vendor_id"] };
  return null;
}
