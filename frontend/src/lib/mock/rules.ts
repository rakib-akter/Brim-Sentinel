/**
 * Mock-backend rules. These stand in for what the FastAPI services will compute
 * (home buckets, plain-language status, next action, eligible releaser).
 * The UI consumes their output; it never makes authorization decisions itself.
 */
import { ROLES } from "@/lib/domain/roles";
import { inGroup } from "@/lib/domain/status-groups";
import type {
  HomeSummary,
  Invoice,
  InvoiceListParams,
  ValidationCheck,
  InvoiceStatus,
  InvoiceTask,
  PrimaryAction,
  User,
} from "@/lib/domain/types";

export const ATTENTION_STATUSES: InvoiceStatus[] = ["needs_review", "on_hold"];
export const UPCOMING_STATUSES: InvoiceStatus[] = ["approved", "scheduled"];

const RESOLVER_ROLES = new Set(["ap_clerk", "finance_manager", "controller", "cfo"]);

/** Total converted to CAD minor units using the stored invoice-date FX rate. */
export function amountCadMinor(inv: Invoice): number | null {
  if (inv.totalMinor === null) return null;
  return inv.currency === "USD" ? Math.round(inv.totalMinor * (inv.fxToCad ?? 1)) : inv.totalMinor;
}

export function currentStep(inv: Invoice) {
  return inv.approvalChain.find((s) => s.status === "pending");
}

export function isAwaitingUser(inv: Invoice, user: User): boolean {
  return inv.status === "pending_approval" && currentStep(inv)?.userId === user.id;
}

const RELEASERS = {
  financeManager: { id: "U003", name: "Priya Raman" },
  controllers: [
    { id: "U002", name: "Marcus Lindqvist" },
    { id: "U001", name: "Evelyn Hart" },
  ],
};

/**
 * Eligible releaser per P09–P11: Finance Manager up to CAD 100,000, otherwise a
 * controller_admin; never anyone in the approval chain. Returns null when nobody
 * is eligible (NO_ELIGIBLE_RELEASER).
 */
export function eligibleReleaser(inv: Invoice): { id: string; name: string } | null {
  const cad = amountCadMinor(inv);
  if (cad === null) return null;
  const approvers = new Set(inv.approvalChain.map((s) => s.userId));
  const candidates =
    cad <= 100_000_00
      ? [RELEASERS.financeManager, ...RELEASERS.controllers]
      : RELEASERS.controllers;
  return candidates.find((c) => !approvers.has(c.id)) ?? null;
}

export function plainStatus(inv: Invoice): string {
  const top = inv.findings.find((f) => f.blocking) ?? inv.findings[0];
  switch (inv.status) {
    case "processing":
      return "Reading the document…";
    case "needs_review":
      return top ? top.title : "Ready for your review";
    case "on_hold":
      return `Payment paused: ${top ? top.title.charAt(0).toLowerCase() + top.title.slice(1) : "needs attention"}`;
    case "pending_approval": {
      const s = currentStep(inv);
      return s ? `Waiting for ${s.userName} (${ROLES[s.role].label})` : "Waiting for approval";
    }
    case "approved":
      return "Approved — waiting for simulated release";
    case "scheduled":
      return "Simulated payment scheduled";
    case "released":
      return "Simulated payment released";
    case "settled":
      return "Simulated settlement complete";
    case "failed":
      return "Simulated payment failed — needs a retry decision";
    case "credit_recorded":
      return "Credit recorded — reduces what we owe";
    case "rejected":
      return "Rejected";
    case "non_payable":
      return "Not a payable document";
  }
}

export function ownerFor(inv: Invoice): string {
  switch (inv.status) {
    case "processing":
    case "needs_review":
    case "on_hold":
      return "AP team";
    case "pending_approval":
      return currentStep(inv)?.userName ?? "Approvers";
    case "approved":
    case "scheduled":
    case "failed":
      return eligibleReleaser(inv)?.name ?? "Escalation needed";
    default:
      return "Finance";
  }
}

export function primaryActionFor(inv: Invoice, user: User): PrimaryAction {
  if (user.role === "auditor") return { kind: "view_record", label: "View record", emphasis: "quiet" };
  const canResolve = RESOLVER_ROLES.has(user.role);
  switch (inv.status) {
    case "processing":
      return { kind: "processing", label: "Processing…", emphasis: "quiet", disabled: true };
    case "needs_review": {
      if (!canResolve) return { kind: "view_record", label: "View status", emphasis: "quiet" };
      if (inv.findings.some((f) => f.code === "MISSING_ATTACHMENT"))
        return { kind: "request_document", label: "Request document", emphasis: "primary" };
      if (inv.findings.some((f) => f.code === "EXTRACTION_UNREADABLE"))
        return { kind: "fix_extraction", label: "Enter missing details", emphasis: "primary" };
      return { kind: "review", label: "Review", emphasis: "primary" };
    }
    case "on_hold":
      if (!canResolve) return { kind: "view_record", label: "View status", emphasis: "quiet" };
      if (inv.findings.some((f) => f.code === "BANK_CHANGE_UNVERIFIED"))
        return { kind: "review_bank_details", label: "Review bank details", emphasis: "primary" };
      return { kind: "resolve_issue", label: "Resolve issue", emphasis: "primary" };
    case "pending_approval":
      return isAwaitingUser(inv, user)
        ? { kind: "approve", label: "Review & approve", emphasis: "primary" }
        : { kind: "view_approval", label: "View approval", emphasis: "secondary" };
    case "approved":
    case "scheduled":
    case "released":
    case "failed":
      return { kind: "view_payment", label: "View payment", emphasis: "secondary" };
    default:
      return { kind: "view_record", label: "View record", emphasis: "quiet" };
  }
}

/** Invoices a user may see (backend enforces this independently). */
export function scopeFor(invoices: Invoice[], user: User): Invoice[] {
  switch (user.role) {
    case "requester":
      return invoices.filter((i) => i.requesterId === user.id);
    case "dept_approver":
      return invoices.filter((i) => i.department === user.department || isAwaitingUser(i, user));
    default:
      return invoices;
  }
}

export function toTask(inv: Invoice, user: User): InvoiceTask {
  return { invoice: inv, plainStatus: plainStatus(inv), owner: ownerFor(inv), action: primaryActionFor(inv, user) };
}

const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const;
const byDue = (a: Invoice, b: Invoice) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

export function buildHomeSummary(all: Invoice[], user: User): HomeSummary {
  const visible = scopeFor(all, user);
  const attention =
    user.role === "auditor"
      ? []
      : visible
          .filter((i) => ATTENTION_STATUSES.includes(i.status))
          .sort((a, b) => {
            const blockA = a.findings.some((f) => f.blocking) ? 0 : 1;
            const blockB = b.findings.some((f) => f.blocking) ? 0 : 1;
            return blockA - blockB || RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || byDue(a, b);
          });
  const approvals = all.filter((i) => isAwaitingUser(i, user)).sort(byDue);
  const upcoming = visible
    .filter((i) => UPCOMING_STATUSES.includes(i.status))
    .sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""));

  return {
    needsAttention: attention.map((i) => toTask(i, user)),
    readyForApproval: approvals.map((i) => toTask(i, user)),
    upcomingPayments: upcoming.map((i) => toTask(i, user)),
    metrics: {
      processed: visible.filter((i) => i.status !== "processing").length,
      needsReview: visible.filter((i) => i.status === "needs_review").length,
      onHold: visible.filter((i) => i.status === "on_hold").length,
      upcomingPayments: upcoming.length,
    },
  };
}

export function filterInvoices(invoices: Invoice[], params: InvoiceListParams): Invoice[] {
  const q = params.q?.trim().toLowerCase();
    return invoices
    .filter((i) => inGroup(i.status, params.status ?? "all"))
    .filter((i) =>
      q
        ? [i.supplierName, i.number ?? "", i.id, i.sourceRef].some((v) => v.toLowerCase().includes(q))
        : true,
    )
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/**
 * Validation check results (PRD FR-04). UNKNOWN is never shown as a pass.
 * Mock: derived from the invoice's findings; the backend will return real results.
 */
export function checksFor(inv: Invoice): ValidationCheck[] {
  const has = (code: string) => inv.findings.find((f) => f.code === code);
  const r = (name: string, result: ValidationCheck["result"], note: string): ValidationCheck => ({ name, result, note });
  const unread = inv.totalMinor === null;
  const unknownVendor = has("UNKNOWN_VENDOR") || inv.supplierId === "PENDING";
  return [
    unknownVendor
      ? r("Vendor", "FAIL", "Supplier not found in the vendor list")
      : has("DUPLICATE_VENDOR_IDENTITY")
        ? r("Vendor", "FAIL", "Looks like an existing supplier record")
        : has("VENDOR_PENDING_REVIEW")
          ? r("Vendor", "UNKNOWN", "Supplier onboarding not complete")
          : r("Vendor", "PASS", "Active supplier on file"),
    has("BANK_CHANGE_UNVERIFIED")
      ? r("Bank details", "FAIL", "Changed by email request; callback not recorded")
      : unknownVendor
        ? r("Bank details", "UNKNOWN", "No verified bank details on file")
        : r("Bank details", "PASS", "No recent changes"),
    unread
      ? r("Invoice math", "UNKNOWN", "Total not extracted")
      : r("Invoice math", "PASS", "Line items add up to the total"),
    unread
      ? r("Taxes", "UNKNOWN", "Not extracted")
      : inv.taxes.length === 0
        ? r("Taxes", "NOT_APPLICABLE", inv.currency === "USD" ? "Foreign supplier — no Canadian tax charged" : "No tax lines")
        : r("Taxes", "PASS", inv.taxes.map((t) => t.label).join(" + ")),
    inv.poNumber
      ? r("Purchase order", "PASS", `${inv.poNumber} has enough remaining balance`)
      : r("Purchase order", "NOT_APPLICABLE", "Supplier does not require a PO"),
    has("FUEL_SURCHARGE_UNUSUAL")
      ? r("Contract", "FAIL", "Fuel surcharge above this supplier's usual rate")
      : unknownVendor || unread
        ? r("Contract", "UNKNOWN", "No contract matched yet")
        : r("Contract", "PASS", "Within contract terms"),
    has("DUPLICATE_CANDIDATE")
      ? r("Duplicates", "FAIL", "Similar invoice from the same supplier")
      : unread
        ? r("Duplicates", "UNKNOWN", "Can't compare without a number and total")
        : r("Duplicates", "PASS", "No matching invoices or Brim card charges"),
    has("AMOUNT_UNUSUAL")
      ? r("Usual amount", "FAIL", "Well above this supplier's typical invoice")
      : unread || unknownVendor
        ? r("Usual amount", "UNKNOWN", "Insufficient supplier history")
        : r("Usual amount", "PASS", "In line with past invoices"),
    has("NO_ELIGIBLE_RELEASER")
      ? r("Payment release", "FAIL", "No eligible independent releaser above CAD 250,000")
      : r("Payment release", "PASS", "An independent releaser is available"),
  ];
}
