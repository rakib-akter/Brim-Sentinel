import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api/client";
import { caseQuery } from "@/lib/api/queries";
import type { CaseDetail } from "@/lib/api/schema";
import { useSession } from "@/lib/session";
import { BankAuthorizationForm, BankVerificationForm } from "./bank-change-forms";
import { Evidence } from "./flight-recorder";
import { InvestigatePanel } from "./investigate-panel";
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
      <InvestigatePanel caseId={data.id} />
      {data.wizard && <BankWizard data={data} />}
      {data.wizard?.current_step === "done" &&
        data.actions.some(
          (action) =>
            action.action_type === "authorization_request" &&
            action.data["invoice_version"] === data.invoice.version,
        ) && (
          <p role="status" className="text-sm text-muted-foreground">
            Invoice approval request recorded. Required approvers can review it in Approvals.
          </p>
        )}
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

const wizardFailures: Record<string, string> = {
  TRUSTED_CONTACT_MISSING:
    "No trusted contact predates the request. Ask finance to review the supplier’s contact records.",
  CALLBACK_DENIED_CHANGE: "The trusted contact denied the change. Escalate the case to finance.",
  NO_ELIGIBLE_RELEASER:
    "No eligible independent releaser is available. Escalate to the controller for a documented decision.",
};

function BankWizard({ data }: { data: CaseDetail }) {
  const { user } = useSession();
  const { bank_change: bank, wizard } = data;
  if (!wizard) return null;
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
        {wizard.failure_states
          .filter((state) => state !== "VERIFIED_CARD_ROUTE_UNAVAILABLE")
          .map((state) => (
            <p key={state} className="text-muted-foreground">
              {wizardFailures[state] ?? humanize(state)}
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
      {bank && (
        <BankVerificationForm
          bank={bank}
          submit={(request) => api.verify(user.id, data.id, request)}
        />
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
      {bank && (
        <BankAuthorizationForm
          bank={bank}
          submit={(request) => api.authorizeRoute(user.id, data.id, request)}
        />
      )}
    </div>
  );
}
