import { api } from "@/lib/api/client";
import type { InvoiceDetail } from "@/lib/api/schema";
import { useSession } from "@/lib/session";
import { Choice, Field, value, WorkflowForm } from "./workflow-form";

export function ApprovalDecision({ invoice }: { invoice: InvoiceDetail }) {
  const { user } = useSession();
  const step = invoice.approval_chain.find(
    (item) => item.status === "PENDING" && item.assigned_actor_id === user.id,
  );
  const options = [
    { value: "APPROVED", label: "Approve", action: "approve" },
    { value: "REJECTED", label: "Reject", action: "reject" },
  ].filter((option) => invoice.allowed_actions.includes(option.action));
  if (!step || !options.length) return null;

  return (
    <WorkflowForm
      label="Record approval decision"
      run={async (fields) => {
        const decision = value(fields, "decision");
        const reason = value(fields, "reason");
        if (decision !== "APPROVED" && decision !== "REJECTED")
          throw new Error("Choose a decision.");
        if (decision === "REJECTED" && !reason) throw new Error("Enter a rejection reason.");
        return api.decide(user.id, invoice.id, step.step_key, {
          expected_version: invoice.version,
          decision,
          reason: reason || null,
        });
      }}
    >
      <Choice label="Decision" name="decision" options={options} />
      <Field label="Reason (required for rejection)" name="reason" required={false} />
    </WorkflowForm>
  );
}

export function InvoiceCorrections({ invoice }: { invoice: InvoiceDetail }) {
  const { user } = useSession();
  const token = { expected_version: invoice.version };
  const allowed = invoice.allowed_actions;
  const editable = [
    { value: "invoice_number", label: "Invoice number" },
    { value: "vendor_id", label: "Supplier ID" },
    { value: "po_number", label: "Purchase order number" },
    { value: "department_id", label: "Department ID" },
    { value: "invoice_date", label: "Invoice date (YYYY-MM-DD)" },
    { value: "due_date", label: "Due date (YYYY-MM-DD)" },
    { value: "subtotal", label: "Subtotal (decimal)" },
    { value: "total", label: "Total (decimal)" },
    { value: "currency", label: "Currency (CAD or USD)" },
  ];
  if (
    !["edit_fields", "coding_decision", "revalidate", "cancel"].some((action) =>
      allowed.includes(action),
    )
  )
    return null;

  return (
    <details className="surface space-y-4 px-5 py-4">
      <summary className="cursor-pointer text-sm font-semibold">Corrections and checks</summary>
      {allowed.includes("edit_fields") && (
        <WorkflowForm
          label="Save correction"
          run={async (fields) => {
            const field = value(fields, "field");
            if (!editable.some((option) => option.value === field))
              throw new Error("Select a field to correct.");
            return api.edit(user.id, invoice.id, {
              ...token,
              reason: value(fields, "reason"),
              fields: { [field]: value(fields, "new_value") },
            });
          }}
        >
          <p className="text-sm text-muted-foreground">
            Material changes create a new invoice version and invalidate earlier approvals.
          </p>
          <Choice label="Invoice field" name="field" options={editable} />
          <Field label="Corrected value" name="new_value" />
          <Field label="Correction reason" name="reason" />
        </WorkflowForm>
      )}
      {allowed.includes("coding_decision") && invoice.line_items.length > 0 && (
        <WorkflowForm
          label="Save line coding"
          run={(fields) =>
            api.coding(user.id, invoice.id, {
              ...token,
              lines: [
                {
                  line_no: Number(value(fields, "line")),
                  gl_account: value(fields, "account") || null,
                  department_id: value(fields, "department") || null,
                  reason: value(fields, "reason"),
                },
              ],
            })
          }
        >
          <Choice
            label="Invoice line"
            name="line"
            options={invoice.line_items.map((line) => ({
              value: String(line.line_no),
              label: `${line.line_no} · ${line.description}`,
            }))}
          />
          <Field label="GL account (optional)" name="account" required={false} />
          <Field label="Department ID (optional)" name="department" required={false} />
          <Field label="Coding reason" name="reason" />
        </WorkflowForm>
      )}
      {allowed.includes("revalidate") && (
        <WorkflowForm
          label="Re-run invoice checks"
          run={() => api.revalidate(user.id, invoice.id, token)}
        />
      )}
      {allowed.includes("cancel") && (
        <WorkflowForm
          label="Cancel held invoice"
          run={(fields) =>
            api.cancel(user.id, invoice.id, { ...token, reason: value(fields, "reason") })
          }
        >
          <Field name="reason" label="Cancellation reason" />
        </WorkflowForm>
      )}
    </details>
  );
}
