import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api/client";
import { caseQuery } from "@/lib/api/queries";
import type { CaseDetail } from "@/lib/api/schema";
import { useSession } from "@/lib/session";
import { BankAuthorizationForm, BankVerificationForm } from "./bank-change-forms";
import { describeData, plain } from "@/lib/plain-language";
import { Evidence } from "./flight-recorder";
import { InvestigatePanel } from "./investigate-panel";
import { Choice, errorMessage, Field, humanize, value, WorkflowForm } from "./workflow-form";

export function ResolutionCase({ id }: { id: string }) {
  const { user, users, permissions } = useSession();
  const { data, error } = useQuery(caseQuery(user.id, id));
  const nameOf = (actorId: string | null | undefined) =>
    actorId ? (users.find((u) => u.id === actorId)?.name ?? "Sentinel") : "Sentinel";
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
          {humanize(data.state)} · Owner:{" "}
          {data.owner_id ? nameOf(data.owner_id) : humanize(data.owner_role)} · Invoice{" "}
          <Link
            className="text-primary hover:underline"
            to="/invoices/$invoiceId"
            params={{ invoiceId: data.invoice_id }}
          >
            {data.invoice_id}
          </Link>
        </p>
      </div>
      <InvestigatePanel caseId={data.id} issue={data.title} />
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
              <span className="font-medium">{plain(action.action_type)}</span> ·{" "}
              {plain(action.status)} · {nameOf(action.actor_id)}
            </p>
            {action.notes && <p className="text-muted-foreground">{action.notes}</p>}
            <ul className="text-xs text-muted-foreground">
              {describeData(action.data).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
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

const WIZARD_STEPS: Array<{
  key: string;
  title: string;
  why: string;
  actor: string;
}> = [
  {
    key: "review",
    title: "Review change",
    why: "A request to change where we pay this supplier arrived. Payment is paused until it's proven genuine.",
    actor: "AP clerk",
  },
  {
    key: "verify_supplier",
    title: "Independently verify",
    why: "Call the supplier on a contact that was on file before the request. Details supplied with the request are never trusted.",
    actor: "AP clerk who did not enter the change",
  },
  {
    key: "choose_route",
    title: "Select verified route",
    why: "A different person in finance authorizes the verified account (two-person control).",
    actor: "Finance manager",
  },
  {
    key: "request_authorization",
    title: "Request authorization",
    why: "Checks re-run on the current version, then the required approvers decide. Release stays independent.",
    actor: "AP clerk, then approvers",
  },
];

function BankWizard({ data }: { data: CaseDetail }) {
  const { user } = useSession();
  const { bank_change: bank, wizard } = data;
  if (!wizard) return null;
  const done = (key: string) =>
    wizard.current_step === "done" ||
    wizard.steps.some((s) => s["key"] === key && s["done"] === true);
  const currentIdx = WIZARD_STEPS.findIndex((s) => s.key === wizard.current_step);
  const current = WIZARD_STEPS[currentIdx];
  const canVerify = !!bank?.allowed_actions.includes("record_verification");
  const canAuthorize = !!bank?.allowed_actions.includes("authorize_route");
  const enteredByMe = bank?.requested_by_user_id === user.id;
  const blockedReason =
    current?.key === "verify_supplier" && !canVerify
      ? enteredByMe
        ? "You entered this bank change, so someone independent must verify it."
        : bank && !bank.trusted_contacts.length
          ? "No trusted contact predates the request, so it can't be verified by callback."
          : "Your demo identity can't record this verification."
      : current?.key === "choose_route" && !canAuthorize
        ? "Only a finance manager who didn't verify the change can authorize the route."
        : null;
  return (
    <div className="space-y-4">
      <h4
        className={`flex items-center gap-2 text-sm font-semibold ${
          wizard.hold_active ? "text-critical-foreground" : "text-success-foreground"
        }`}
      >
        <span
          className={`size-2 rounded-full ${wizard.hold_active ? "bg-critical" : "bg-success"}`}
          aria-hidden
        />
        {wizard.hold_active ? "Payment paused" : "Bank verification complete"}
      </h4>
      <ol className="grid grid-cols-2 gap-2 2xl:grid-cols-4" aria-label="Bank change steps">
        {WIZARD_STEPS.map((step, i) => {
          const isDone = done(step.key);
          const isCurrent = step.key === wizard.current_step;
          return (
            <li
              key={step.key}
              aria-current={isCurrent ? "step" : undefined}
              className={`relative rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                isCurrent
                  ? "border-primary/50 bg-primary-soft/50 ring-1 ring-primary/20"
                  : isDone
                    ? "bg-success-soft/40"
                    : "bg-card text-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                    isDone
                      ? "bg-success text-white"
                      : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {isDone ? "✓" : i + 1}
                </span>
                <span className="font-medium text-foreground">{step.title}</span>
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">{step.actor}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="eyebrow">Requested change</p>
          {bank ? (
            <>
              <p className="figure mt-1 text-base font-semibold">
                {bank.old_account_masked ?? "Unknown"}{" "}
                <span className="text-muted-foreground">→</span>{" "}
                {bank.new_account_masked ?? "Unknown"}
              </p>
              <p className="text-xs text-muted-foreground">
                {bank.id} · {plain(bank.request_channel)} · {plain(bank.state)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Account numbers are masked. Contact details sent with the request are not trusted.
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No bank change record is attached.</p>
          )}
        </div>
        <div>
          <p className="eyebrow">Trusted verification source</p>
          {bank?.trusted_contacts.length ? (
            <ul className="mt-1 space-y-0.5 text-xs">
              {bank.trusted_contacts.map((c) => (
                <li key={c.id}>
                  {c.value}{" "}
                  <span className="text-muted-foreground">
                    · {plain(c.source)} · on file since {c.established_at}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">None on file before the request.</p>
          )}
          {bank?.verification_outcome && (
            <p className="mt-1 text-xs">
              Callback: {plain(bank.verification_outcome)} · {bank.verification_evidence_ref}
            </p>
          )}
        </div>
      </div>

      {current && wizard.current_step !== "done" && (
        <div className="rounded-xl border-l-4 border-l-primary bg-secondary/50 px-4 py-3 text-sm">
          <p className="font-medium">
            Step {currentIdx + 1}: {current.title}
            <span className="font-normal text-muted-foreground"> · who acts: {current.actor}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{current.why}</p>
          {blockedReason && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-foreground">
              <span aria-hidden>●</span> {blockedReason} Switch demo identity to see their view.
            </p>
          )}
        </div>
      )}
      {wizard.failure_states
        .filter((state) => state !== "VERIFIED_CARD_ROUTE_UNAVAILABLE")
        .map((state) => (
          <p key={state} role="alert" className="text-sm text-critical-foreground">
            {wizardFailures[state] ?? humanize(state)}
          </p>
        ))}

      {/* Forms gate themselves on the bank change's allowed_actions. */}
      {bank && (
        <BankVerificationForm
          bank={bank}
          submit={(request) => api.verify(user.id, data.id, request)}
        />
      )}

      {(wizard.current_step === "choose_route" || wizard.current_step === "verify_supplier") && (
        <details className="text-sm" open={wizard.current_step === "choose_route"}>
          <summary className="cursor-pointer font-medium">Payment route options</summary>
          <ul className="mt-2 space-y-2">
            {wizard.route_options.map((route) => (
              <li key={String(route["method"])} className="rounded-lg border px-3 py-2">
                <p className="font-medium">
                  {String(route["label"] ?? route["method"])}
                  {route["account_masked"] != null && (
                    <span className="figure font-normal"> · {String(route["account_masked"])}</span>
                  )}
                  <span
                    className={`ml-2 rounded-full px-1.5 py-px text-[10px] font-medium ${
                      route["available"]
                        ? "bg-success-soft text-success-foreground"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {route["available"] ? "Available" : "Not available yet"}
                  </span>
                </p>
                {route["reason"] != null && (
                  <p className="text-xs text-muted-foreground">{String(route["reason"])}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {bank && (
        <BankAuthorizationForm
          bank={bank}
          submit={(request) => api.authorizeRoute(user.id, data.id, request)}
        />
      )}
    </div>
  );
}
