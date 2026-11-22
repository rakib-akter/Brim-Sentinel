import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api } from "@/lib/api/client";
import { caseQuery } from "@/lib/api/queries";
import type { CaseDetail } from "@/lib/api/schema";
import { useSession } from "@/lib/session";
import { BankAuthorizationForm, BankVerificationForm } from "./bank-change-forms";
import { describeData, plain, plainSentence } from "@/lib/plain-language";
import { clock, Message, SentinelAiTurn } from "./investigate-panel";
import { Choice, errorMessage, Field, humanize, value, WorkflowForm } from "./workflow-form";

const ROLE_LABEL: Record<string, string> = {
  system: "Sentinel (automatic)",
  ap_clerk: "AP clerk",
  finance_manager: "Finance manager",
  controller_admin: "Controller",
  approver: "Required approvers",
  releaser: "Independent releaser",
};
const roleLabel = (role: unknown) => ROLE_LABEL[String(role)] ?? humanize(String(role ?? ""));

/**
 * A resolution case laid out as a conversation and a checklist: on the left, what Sentinel's checks
 * found, what people recorded and (on request) what Sentinel AI read and suggests; on the right,
 * the real Path to Pay steps from the backend, with the form for the current step only.
 */
export function ResolutionCase({ id }: { id: string }) {
  const { user, users } = useSession();
  const { data, error } = useQuery(caseQuery(user.id, id));
  const person = (actorId: string | null | undefined) =>
    actorId ? users.find((u) => u.id === actorId) : undefined;
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
  const held = data.wizard ? data.wizard.hold_active : data.invoice.lifecycle_state === "ON_HOLD";
  const bank = data.bank_change;
  const verifier = person(bank?.verifier_id);
  return (
    <article className="space-y-4" aria-labelledby={`case-${data.id}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={`case-${data.id}`} className="text-lg font-semibold tracking-tight">
          {data.title}
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            held
              ? "bg-critical-soft text-critical-foreground"
              : "bg-success-soft text-success-foreground"
          }`}
        >
          {held
            ? "Payment paused"
            : data.wizard
              ? "Bank verification complete"
              : humanize(data.state)}
        </span>
        <span className="figure text-xs text-muted-foreground">{data.id}</span>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Conversation */}
        <section className="surface px-5 py-5" aria-label="Case conversation">
          <ol className="space-y-4">
            {data.findings.map((f) => (
              <Message
                key={f.id}
                speaker="checks"
                name="Sentinel checks"
                tag={
                  f.blocking ? (
                    <span className="rounded-full bg-critical-soft px-2 py-px text-[10px] font-semibold text-critical-foreground">
                      Paused payment
                    </span>
                  ) : undefined
                }
                time={clock(data.created_at)}
              >
                <p>
                  {f.blocking ? "I paused payment on this invoice. " : ""}
                  {plainSentence(f.rationale)}
                </p>
                {f.why_it_matters && <p className="text-muted-foreground">{f.why_it_matters}</p>}
              </Message>
            ))}
            {bank?.verification_outcome && (
              <Message
                speaker="person"
                name={verifier?.name ?? "Verifier"}
                initials={verifier?.initials ?? "—"}
                time={clock(bank.verification_occurred_at)}
              >
                <p>
                  Called the supplier on a contact already on file. Outcome:{" "}
                  <span className="font-medium">{plain(bank.verification_outcome)}</span>.
                </p>
                <p className="figure text-xs text-muted-foreground">
                  Call log {bank.verification_evidence_ref}
                </p>
              </Message>
            )}
            {data.actions.map((action) => {
              const who = person(action.actor_id);
              return (
                <Message
                  key={action.id}
                  speaker="person"
                  name={who?.name ?? "Sentinel"}
                  initials={who?.initials ?? "S"}
                  time={clock(action.created_at)}
                >
                  <p className="font-medium">{plain(action.action_type)}</p>
                  {action.notes && <p>{action.notes}</p>}
                  {describeData(action.data).length > 0 && (
                    <ul className="text-xs text-muted-foreground">
                      {describeData(action.data).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </Message>
              );
            })}
            <SentinelAiTurn caseId={data.id} />
          </ol>
        </section>

        {/* Checklist */}
        <TaskChecklist data={data} />
      </div>
    </article>
  );
}

function TaskChecklist({ data }: { data: CaseDetail }) {
  const steps = data.path_to_pay_steps;
  const doneCount = steps.filter((s) => s["status"] === "DONE").length;
  const currentIdx = steps.findIndex((s) => s["status"] === "CURRENT");
  return (
    <section className="surface px-5 py-4 lg:sticky lg:top-40" aria-labelledby={`tasks-${data.id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`tasks-${data.id}`} className="font-semibold">
          Path to pay
        </h3>
        <p className="text-xs text-muted-foreground">
          {doneCount}/{steps.length} done
        </p>
      </div>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => {
          const status = String(step["status"]);
          const done = status === "DONE";
          const current = i === currentIdx;
          return (
            <li key={String(step["key"] ?? i)} aria-current={current ? "step" : undefined}>
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2 ${
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : current
                        ? "border-primary"
                        : "border-border-strong"
                  }`}
                  aria-hidden
                >
                  {done && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-sm leading-snug ${
                      done
                        ? "text-muted-foreground line-through"
                        : current
                          ? "font-semibold text-primary"
                          : ""
                    }`}
                  >
                    {String(step["label"])}
                  </p>
                  <p className={`text-xs ${current ? "text-primary" : "text-muted-foreground"}`}>
                    {roleLabel(step["actor_role"])}
                    {current ? " · Now" : done ? " · Done" : ""}
                  </p>
                </div>
              </div>
              {current && <CurrentStep data={data} />}
            </li>
          );
        })}
      </ol>
      {currentIdx === -1 && <CurrentStep data={data} />}
      {data.allowed_actions.some((action) =>
        ["note", "escalate", "request_information", "document_decision"].includes(action),
      ) && (
        <details className="mt-4 border-t pt-3 text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            Add a note or escalate
          </summary>
          <div className="mt-2">
            <CaseActionForm key={data.row_version} data={data} />
          </div>
        </details>
      )}
    </section>
  );
}

/** The one thing to do now: who acts, why, and the form if this person may act. */
function CurrentStep({ data }: { data: CaseDetail }) {
  const { user, permissions } = useSession();
  const { bank_change: bank, wizard } = data;
  const canVerify = !!bank?.allowed_actions.includes("record_verification");
  const canAuthorize = !!bank?.allowed_actions.includes("authorize_route");
  const enteredByMe = bank?.requested_by_user_id === user.id;
  const blockedReason = !wizard
    ? null
    : wizard.current_step === "verify_supplier" && !canVerify
      ? enteredByMe
        ? "You entered this bank change, so someone else must verify it."
        : bank && !bank.trusted_contacts.length
          ? "No trusted contact predates the request, so it can't be verified by callback."
          : "Your demo identity can't record this verification."
      : wizard.current_step === "choose_route" && !canAuthorize
        ? "Only a finance manager who didn't verify the change can authorize it."
        : null;
  const canRequest =
    !!wizard &&
    !wizard.hold_active &&
    wizard.current_step === "request_authorization" &&
    permissions.includes("case.authorization_request") &&
    ["PENDING_APPROVAL", "APPROVED"].includes(data.invoice.lifecycle_state);
  const requested = data.actions.some(
    (action) =>
      action.action_type === "authorization_request" &&
      action.data["invoice_version"] === data.invoice.version,
  );
  const canRevalidate =
    !wizard &&
    data.invoice.allowed_actions.includes("revalidate") &&
    data.invoice.lifecycle_state === "ON_HOLD";
  const failures = (wizard?.failure_states ?? []).filter(
    (state) => state !== "VERIFIED_CARD_ROUTE_UNAVAILABLE",
  );
  return (
    <div className="expand-in mt-3 space-y-3 rounded-xl border bg-secondary/40 p-3 text-sm">
      {bank && wizard?.current_step !== "done" && (
        <div className="space-y-1 text-xs">
          <p>
            <span className="text-muted-foreground">Change requested: </span>
            <span className="figure font-medium">
              {bank.old_account_masked ?? "Unknown"} → {bank.new_account_masked ?? "Unknown"}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">Call only: </span>
            {bank.trusted_contacts.length
              ? bank.trusted_contacts.map((c) => c.value).join(", ")
              : "no contact on file before the request"}
          </p>
          <p className="text-muted-foreground">
            Contact details sent with the request are never trusted.
          </p>
        </div>
      )}
      {blockedReason && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
          {blockedReason} Switch demo identity to see their view.
        </p>
      )}
      {failures.map((state) => (
        <p key={state} role="alert" className="text-xs text-critical-foreground">
          {wizardFailures[state] ?? humanize(state)}
        </p>
      ))}
      {/* Forms gate themselves on the bank change's allowed_actions. */}
      {bank && canVerify && (
        <details className="group" open={undefined}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 group-open:hidden">
            Record the callback result
          </summary>
          <div className="space-y-3">
            <BankVerificationForm
              bank={bank}
              submit={(request) => api.verify(user.id, data.id, request)}
            />
          </div>
        </details>
      )}
      {bank && (
        <BankAuthorizationForm
          bank={bank}
          submit={(request) => api.authorizeRoute(user.id, data.id, request)}
        />
      )}
      {canRequest && (
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
      {requested && (
        <p role="status" className="text-xs text-muted-foreground">
          Invoice approval request recorded. Required approvers can review it in Approvals.
        </p>
      )}
      {canRevalidate && (
        <WorkflowForm
          label="Re-run invoice checks"
          run={() =>
            api.revalidate(user.id, data.invoice_id, { expected_version: data.invoice.version })
          }
        />
      )}
      {!bank && !canRevalidate && !failures.length && (
        <p className="text-xs text-muted-foreground">
          The owner completes this step; Sentinel re-checks the invoice once it's done.
        </p>
      )}
    </div>
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
