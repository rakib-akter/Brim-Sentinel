import type { InvoiceStatus, InvoiceTask, InvoiceDetail, RoleId, User } from "@/lib/domain/types";
import type * as Schema from "./schema";

export function roleLabelId(role: string, title = ""): RoleId {
  switch (role) {
    case "employee":
      return "requester";
    case "approver":
      return "dept_approver";
    case "controller_admin":
      return title === "Chief Financial Officer" ? "cfo" : "controller";
    case "cfo":
    case "ap_clerk":
    case "finance_manager":
    case "auditor":
      return role;
    default:
      return "requester";
  }
}

export function presentUser(user: Schema.UserOut): User {
  return {
    id: user.id,
    name: user.full_name,
    title: user.title,
    role: roleLabelId(user.role, user.title),
    department: user.department_id ?? "Unassigned",
    initials: user.full_name
      .split(/\s+/)
      .slice(0, 2)
      .map((name) => name[0])
      .join(""),
  };
}

const STATE: Record<string, InvoiceStatus> = {
  RECEIVED: "processing",
  DRAFT: "needs_review",
  EXTRACTED: "processing",
  CODED: "processing",
  VALIDATED: "needs_review",
  ON_HOLD: "on_hold",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  SCHEDULED: "scheduled",
  RELEASED: "released",
  SETTLED: "settled",
  FAILED: "failed",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  CREDIT_RECORDED: "credit_recorded",
};

export function presentInvoice(row: Schema.InvoiceSummary): InvoiceTask {
  const { kind, label } = row.primary_action;
  return {
    record: row,
    invoice: {
      id: row.id,
      number: row.invoice_number,
      kind: row.kind,
      supplierId: row.vendor_id ?? "",
      supplierName: row.vendor_name ?? "Supplier unknown",
      totalMinor: row.amount_minor,
      currency: row.currency,
      subtotalMinor: null,
      taxes: [],
      issueDate: row.invoice_date,
      dueDate: row.due_date,
      receivedAt: "",
      status: STATE[row.lifecycle_state] ?? "needs_review",
      risk:
        row.risk_band === "high" || row.risk_band === "medium" || row.risk_band === "low"
          ? row.risk_band
          : null,
      language: null,
      scanned: false,
      channel: row.source_kind === "upload" ? "upload" : "email",
      sourceRef: row.source_kind,
      fileName: null,
      department: row.department_id ?? "Unassigned",
      requesterId: row.requester_id ?? "",
      lineItems: [],
      findings: [],
      approvalChain: [],
    },
    plainStatus: row.plain_status,
    owner: row.owner ?? "Unassigned",
    action: { kind, label, emphasis: kind.startsWith("view_") ? "quiet" : "primary" },
  };
}

export function presentDetail(row: Schema.InvoiceDetail): InvoiceDetail {
  const task = presentInvoice(row);
  const doc = row.document_refs[0];
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    ...task,
    invoice: {
      ...task.invoice,
      subtotalMinor: row.subtotal_minor,
      taxes: row.taxes.flatMap((tax) =>
        typeof tax["amount_minor"] === "number"
          ? [{ label: String(tax["label"]), amountMinor: tax["amount_minor"] }]
          : [],
      ),
      language: row.language === "en" || row.language === "fr" ? row.language : null,
      scanned: text(doc?.["mime_type"])?.startsWith("image/") ?? false,
      fileName: text(doc?.["filename"]) ?? null,
      sourceRef: text(doc?.["source_ref"]) ?? row.source_kind,
      poNumber: text(row.extracted_fields["po_number"]),
      fxToCad: text(row.fx?.["rate"]) ?? undefined,
      findings: row.validation_findings
        .filter((f) => !f.dismissed_by && (f.result === "FAIL" || f.result === "UNKNOWN"))
        .map((f) => ({
          id: f.id,
          code: f.code,
          severity:
            f.severity === "high" || f.severity === "critical"
              ? "high"
              : f.severity === "medium" || f.severity === "warning"
                ? "medium"
                : "low",
          blocking: f.blocking,
          title: f.title,
          whyItMatters: f.why_it_matters ?? f.rationale,
          whatHappensNext: f.next_action ?? f.rationale,
          evidenceIds: f.evidence_refs.map((e) => JSON.stringify(e)),
        })),
      approvalChain: row.approval_chain.map((step) => ({
        order: step.step_index,
        role: roleLabelId(step.required_role),
        userId: step.assigned_actor_id ?? "",
        userName: step.assigned_actor_name ?? "Unassigned",
        rules: step.trigger_policy_ids,
        status: (
          {
            APPROVED: "approved",
            PENDING: "pending",
            WAITING: "waiting",
            REJECTED: "rejected",
          } as const
        )[step.status],
        actingFor: step.delegated_from_id ?? undefined,
        note: [step.escalation_reason, step.decision_reason].filter(Boolean).join(" · "),
      })),
    },
    checks: row.validation_findings.map((f) => ({
      id: f.id,
      name: f.title,
      result: f.result,
      note: f.dismissed_by
        ? `Dismissed by ${f.dismissed_by}. ${f.dismissal_reason ?? ""}`
        : f.rationale,
    })),
    eligibleReleaser: row.eligible_releasers.join(", ") || null,
    amountCadMinor: row.amount_cad_minor,
  };
}
