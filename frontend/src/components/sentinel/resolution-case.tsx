import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api/client";
import { caseQuery } from "@/lib/api/queries";
import type { CaseDetail } from "@/lib/api/schema";
import { useSession } from "@/lib/session";
import { Evidence } from "./flight-recorder";
import { Choice, errorMessage, Field, humanize, value, WorkflowForm } from "./workflow-form";

export function ResolutionCase({ id }: { id: string }) {
  const { user, permissions } = useSession();
  const { data, error } = useQuery(caseQuery(user.id, id));
  if (error)
    return (
      <p role="alert" className="text-sm text-critical-foreground">
        {errorMessage(error)}
      </p>
    );
  if (!data)
    return (
      <p role="status" className="text-sm">
        Loading case…
      </p>
    );
  return (
    <article className="surface space-y-4 px-5 py-4">
      <div>
        <h3 className="font-semibold">{data.title}</h3>
        <p className="text-sm text-muted-foreground">
          {humanize(data.state)} · {data.owner_id ?? humanize(data.owner_role)} ·{" "}
          <Link
            className="text-primary hover:underline"
            to="/invoices/$invoiceId"
            params={{ invoiceId: data.invoice_id }}
          >
            {data.invoice_id}
          </Link>
        </p>
      </div>
      {data.wizard && <BankWizard data={data} />}
      <details open={!data.wizard} className="text-sm">
        <summary className="cursor-pointer font-medium">Path to Pay</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          {data.path_to_pay_steps.map((step, index) => (
            <li key={String(step["key"] ?? index)}>
              {String(step["label"])}{" "}
              <span className="text-muted-foreground">· {humanize(String(step["status"]))}</span>
              {step["note"] != null && (
                <p className="text-muted-foreground">{String(step["note"])}</p>
              )}
            </li>
          ))}
        </ol>
      </details>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Findings and case activity</summary>
        {data.findings.map((finding) => (
          <p key={finding.id} className="mt-2">
            {finding.title} · {finding.rationale}
          </p>
        ))}
        <Evidence items={data.evidence_refs} />
        {data.actions.map((action) => (
          <div key={action.id} className="mt-2">
            <p>
              {humanize(action.action_type)} · {action.status} · {action.actor_id} · {action.notes}
            </p>
            <Evidence items={Object.keys(action.data).length ? [action.data] : []} />
          </div>
        ))}
      </details>
      {data.allowed_actions.some((action) =>
        ["note", "escalate", "request_information", "document_decision"].includes(action),
      ) && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Record a case action</summary>
          <CaseActionForm key={data.row_version} data={data} />
        </details>
      )}
      {data.invoice.allowed_actions.includes("revalidate") &&
        !data.wizard &&
        data.invoice.lifecycle_state === "ON_HOLD" && (
          <WorkflowForm
            label="Re-run invoice checks"
            run={() =>
              api.revalidate(user.id, data.invoice_id, { expected_version: data.invoice.version })
            }
          />
        )}
      {data.wizard &&
        !data.wizard.hold_active &&
        data.wizard.current_step === "request_authorization" &&
        permissions.includes("case.authorization_request") &&
        ["PENDING_APPROVAL", "APPROVED"].includes(data.invoice.lifecycle_state) && (
          <WorkflowForm
            label="Request invoice approvals"
            run={(fields) =>
              api.requestAuthorization(user.id, data.id, {
                expected_invoice_version: data.invoice.version,
                notes: value(fields, "notes") || null,
              })
            }
          >
            <Field label="Request notes (optional)" name="notes" required={false} />
          </WorkflowForm>
        )}
    </article>
  );
}

function CaseActionForm({ data }: { data: CaseDetail }) {
  const { user } = useSession();
  const options = [
    { value: "note", label: "Add a note", permission: "note" },
    {
      value: "request_information",
      label: "Draft a request for information",
      permission: "request_information",
    },
    { value: "escalate", label: "Escalate", permission: "escalate" },
    {
      value: "keep_on_hold",
      label: "Document decision to keep on hold",
      permission: "document_decision",
    },
    {
      value: "reject_invoice",
      label: "Document decision to reject invoice",
      permission: "document_decision",
    },
  ].filter((option) => data.allowed_actions.includes(option.permission));
  return (
    <WorkflowForm
      label="Save case action"
      run={(fields) => {
        const action = value(fields, "action");
        const decision = action === "keep_on_hold" || action === "reject_invoice" ? action : null;
        if (
          !decision &&
          action !== "note" &&
          action !== "request_information" &&
          action !== "escalate"
        ) {
          throw new Error("Choose a case action.");
        }
        return api.caseAction(user.id, data.id, {
          action_type: decision
            ? "document_decision"
            : (action as "note" | "request_information" | "escalate"),
          decision,
          notes: value(fields, "notes"),
          expected_row_version: data.row_version,
        });
      }}
    >
      <Choice label="Action" name="action" options={options} />
      <Field label="Notes" name="notes" />
    </WorkflowForm>
  );
}

function BankWizard({ data }: { data: CaseDetail }) {
  const { user } = useSession();
  const { bank_change: bank, wizard } = data;
  if (!wizard) return null;
  const allowed = bank?.allowed_actions ?? [];
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 text-sm">
        <h4 className="font-semibold">
          {wizard.hold_active ? "Payment paused" : "Bank verification complete"}
        </h4>
        {bank && (
          <p>
            Requested change {bank.id} · {bank.old_account_masked ?? "Unknown"} →{" "}
            {bank.new_account_masked ?? "Unknown"} · {bank.request_channel.replaceAll("_", " ")}
          </p>
        )}
        {bank?.verification_outcome && (
          <p>
            Callback outcome {bank.verification_outcome} · {bank.verification_evidence_ref}
          </p>
        )}
        {wizard.failure_states.map((state) => (
          <p key={state} className="text-muted-foreground">
            {humanize(state)}
          </p>
        ))}
      </div>
      <ol className="grid gap-2 sm:grid-cols-4" aria-label="Bank change steps">
        {wizard.steps.map((step) => (
          <li
            key={String(step["key"])}
            aria-current={step["key"] === wizard.current_step ? "step" : undefined}
            className="rounded-lg bg-secondary px-3 py-2 text-sm"
          >
            {String(step["label"])}
            {step["done"] ? " ✓" : step["key"] === wizard.current_step ? " · Current" : ""}
          </li>
        ))}
      </ol>
      {bank && allowed.includes("record_verification") && bank.trusted_contacts.length > 0 && (
        <WorkflowForm
          label="Record supplier verification"
          key={bank.row_version}
          run={(fields) =>
            api.verify(user.id, data.id, {
              expected_row_version: bank.row_version,
              trusted_contact_id: value(fields, "contact"),
              method: "phone_callback_to_contact_on_file",
              occurred_at: new Date(value(fields, "occurred")).toISOString(),
              outcome: value(fields, "outcome") === "CONFIRMED" ? "CONFIRMED" : "DENIED",
              notes: value(fields, "notes"),
              evidence_ref: value(fields, "evidence"),
            })
          }
        >
          <p className="text-sm">
            Call a trusted contact already on file and record the actual outcome.
          </p>
          <Choice
            label="Trusted contact"
            name="contact"
            options={bank.trusted_contacts.map((contact) => ({
              value: contact.id,
              label: `${contact.value} · ${contact.source} · On file since ${contact.established_at}`,
            }))}
          />
          <Field label="Callback time (local time)" name="occurred" type="datetime-local" />
          <Choice
            label="Callback outcome"
            name="outcome"
            options={[
              { value: "CONFIRMED", label: "Supplier confirmed the change" },
              { value: "DENIED", label: "Supplier denied the change" },
            ]}
          />
          <Field label="Call log reference" name="evidence" />
          <Field label="Verification notes" name="notes" />
        </WorkflowForm>
      )}
      <ul className="space-y-1 text-sm">
        {wizard.route_options.map((route) => (
          <li key={String(route["method"])}>
            {String(route["label"] ?? route["method"])} ·{" "}
            {route["available"] ? "Available" : "Unavailable"}
            {route["account_masked"] != null && <> · {String(route["account_masked"])}</>}
            {route["reason"] != null && (
              <p className="text-muted-foreground">{String(route["reason"])}</p>
            )}
          </li>
        ))}
      </ul>
      {bank && allowed.includes("authorize_route") && (
        <WorkflowForm
          label="Authorize verified EFT change"
          run={(fields) =>
            api.authorizeRoute(user.id, data.id, {
              expected_row_version: bank.row_version,
              notes: value(fields, "notes"),
            })
          }
        >
          <Field label="Finance authorization rationale" name="notes" />
        </WorkflowForm>
      )}
    </div>
  );
}
