import type { InvoiceStatus, InvoiceStatusFilter } from "./types";

/** Inbox tab groupings (display only). */
export const STATUS_GROUPS: Record<InvoiceStatusFilter, InvoiceStatus[] | null> = {
  all: null,
  attention: ["needs_review", "on_hold"],
  processing: ["processing"],
  approval: ["pending_approval"],
  payment: ["approved", "scheduled", "released", "failed"],
  done: ["settled", "credit_recorded", "rejected", "cancelled", "non_payable"],
};

export const STATUS_FILTER_LABELS: Record<InvoiceStatusFilter, string> = {
  all: "All",
  attention: "Needs attention",
  processing: "Processing",
  approval: "Awaiting approval",
  payment: "Payments",
  done: "Done",
};

export const STATUS_FILTERS = Object.keys(STATUS_GROUPS) as InvoiceStatusFilter[];

export function inGroup(status: InvoiceStatus, group: InvoiceStatusFilter): boolean {
  const g = STATUS_GROUPS[group];
  return g === null || g.includes(status);
}
