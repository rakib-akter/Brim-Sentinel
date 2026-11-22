import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Lock, Scale } from "lucide-react";
import { api } from "@/lib/api/client";
import { identitiesQuery, policyQuery } from "@/lib/api/queries";
import type { ApprovalPolicyOut, ApprovalPolicyValues, UserOut } from "@/lib/api/schema";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { QueryState } from "./query-state";
import { Choice, Field, value, WorkflowForm } from "./workflow-form";

const APPROVER_ROLES = new Set(["approver", "finance_manager", "controller_admin"]);

const cad = (minor: number) =>
  `CAD ${(minor / 100).toLocaleString("en-CA", { maximumFractionDigits: 2 })}`;

type ThresholdKey = Exclude<
  keyof ApprovalPolicyValues,
  "new_vendor_needs_fm" | "legal_vendor_needs_fm"
>;

const THRESHOLDS: { key: ThresholdKey; label: string; rules: string }[] = [
  {
    key: "dept_manager_up_to_minor",
    label: "Department manager approves alone up to",
    rules: "P01/P02",
  },
  { key: "controller_over_minor", label: "Controller also approves above", rules: "P03" },
  { key: "cfo_over_minor", label: "CFO also approves above", rules: "P04" },
  { key: "fm_release_up_to_minor", label: "Finance manager can release up to", rules: "P09/P10" },
];

/** P01-P13 in plain words; a controller/admin can tighten thresholds and switch P05/P06. */
export function ApprovalRulesSection() {
  const { user } = useSession();
  const policy = useQuery(policyQuery(user.id));
  return (
    <section className="surface overflow-hidden" aria-labelledby="rules-heading">
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <Scale className="mt-0.5 size-4 text-primary" aria-hidden />
        <div>
          <h2 id="rules-heading" className="text-sm font-semibold">
            Approval rules
          </h2>
          <p className="text-xs text-muted-foreground">
            Who must approve an invoice and who may release its payment. The backend applies these
            rules to every invoice; the screen can't bypass them.
          </p>
        </div>
      </header>
      {(policy.error || policy.isPending) && (
        <QueryState error={policy.error} loading="Loading rules…" retry={policy.refetch} />
      )}
      {policy.data && <RulesBody policy={policy.data} />}
    </section>
  );
}

function RulesBody({ policy }: { policy: ApprovalPolicyOut }) {
  return (
    <div className="space-y-4 px-5 py-4">
      <ol className="space-y-1.5 text-sm">
        {policy.rules.map((rule) => (
          <li key={rule.id} className="flex items-start gap-2">
            <span className="figure w-9 shrink-0 text-xs text-muted-foreground">{rule.id}</span>
            <span className="flex-1">{rule.text}</span>
            {rule.editable === "locked" && (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden /> Always on
              </span>
            )}
            {rule.editable === "delegation" && (
              <span className="shrink-0 text-xs text-muted-foreground">See Away & delegation</span>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {policy.version === 0
          ? "These are Harborline's standard rules."
          : `Version ${policy.version}, changed by ${policy.updated_by_name ?? policy.updated_by ?? "an admin"}${
              policy.updated_at
                ? ` on ${formatDate(policy.updated_at, { dateStyle: "medium", timeStyle: "short" })}`
                : ""
            }${policy.reason ? ` — “${policy.reason}”` : ""}.`}
      </p>
      {policy.can_edit ? (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Change the rules</summary>
          <RulesForm key={policy.version} policy={policy} />
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">
          Only the controller or an admin can change these rules.
        </p>
      )}
    </div>
  );
}

function RulesForm({ policy }: { policy: ApprovalPolicyOut }) {
  const { user } = useSession();
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        Rules can be made stricter, never looser than what each role is authorized for. Invoices
        nobody has approved yet are re-routed right away; partly approved invoices keep their
        current approvers. Every change is recorded in the audit log.
      </p>
      <WorkflowForm
        label="Save rules"
        success="Rules saved."
        run={async (fields) => {
          const values: ApprovalPolicyValues = { ...policy.values };
          for (const t of THRESHOLDS) {
            const dollars = Number(value(fields, t.key).replaceAll(",", ""));
            if (!Number.isFinite(dollars)) throw new Error(`${t.label}: enter an amount.`);
            values[t.key] = Math.round(dollars * 100);
          }
          values.new_vendor_needs_fm = fields.get("new_vendor_needs_fm") === "on";
          values.legal_vendor_needs_fm = fields.get("legal_vendor_needs_fm") === "on";
          const out = await api.updatePolicy(user.id, {
            expected_version: policy.version,
            values,
            reason: value(fields, "reason"),
          });
          return out;
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {THRESHOLDS.map((t) => (
            <Field
              key={t.key}
              label={`${t.label} (CAD, ${t.rules}; max ${cad(policy.maximums[t.key] ?? 0)})`}
              name={t.key}
              inputMode="decimal"
              defaultValue={String(policy.values[t.key] / 100)}
            />
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="new_vendor_needs_fm"
            defaultChecked={policy.values.new_vendor_needs_fm}
          />
          New or pending suppliers need the finance manager (P05)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="legal_vendor_needs_fm"
            defaultChecked={policy.values.legal_vendor_needs_fm}
          />
          Legal suppliers need the finance manager (P06)
        </label>
        <Field label="Why are the rules changing?" name="reason" />
      </WorkflowForm>
    </div>
  );
}

/** Approvers mark themselves away with a delegate; a controller/admin can manage anyone. */
export function AwaySection() {
  const { user, permissions } = useSession();
  const identities = useQuery(identitiesQuery());
  const people = (identities.data?.users ?? []).filter(
    (u) => u.kind === "human" && APPROVER_ROLES.has(u.role) && u.status !== "terminated",
  );
  const me = people.find((u) => u.id === user.id);
  const isAdmin = permissions.includes("delegation.manage");
  if (!me && !isAdmin) return null;
  return (
    <section className="surface overflow-hidden" aria-labelledby="away-heading">
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <CalendarOff className="mt-0.5 size-4 text-primary" aria-hidden />
        <div>
          <h2 id="away-heading" className="text-sm font-semibold">
            Away & delegation
          </h2>
          <p className="text-xs text-muted-foreground">
            While someone is away, their delegate approves for them (P08). Waiting approvals move to
            the delegate right away and come back when they return. Delegates still can't approve
            their own invoices or above their limit.
          </p>
        </div>
      </header>
      <div className="space-y-4 px-5 py-4">
        {me && <PersonAway person={me} people={people} self />}
        {isAdmin && (
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Manage the team</summary>
            <ul className="mt-3 divide-y">
              {people
                .filter((p) => p.id !== user.id)
                .map((p) => (
                  <li key={p.id} className="py-3">
                    <PersonAway person={p} people={people} />
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function PersonAway({
  person,
  people,
  self = false,
}: {
  person: UserOut;
  people: UserOut[];
  self?: boolean;
}) {
  const { user } = useSession();
  const cache = useQueryClient();
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["identities"] }),
      cache.invalidateQueries({ queryKey: ["me"] }),
    ]);
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? id ?? "";
  const away = person.status === "on_leave";
  const candidates = people.filter((p) => p.id !== person.id && p.status === "active");
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="font-medium">{self ? "You" : person.full_name}</span>
        {!self && <span className="text-muted-foreground"> · {person.title}</span>}
        {" — "}
        {away ? (
          <span className="text-warning-foreground">
            away{person.status_since ? ` since ${person.status_since}` : ""}, delegate{" "}
            {nameOf(person.delegate_user_id) || "not set"}
          </span>
        ) : (
          <span className="text-success-foreground">available</span>
        )}
      </p>
      {away ? (
        <WorkflowForm
          label={self ? "I'm back" : `Mark ${person.full_name} as back`}
          success="Marked as back. Waiting approvals returned."
          run={async () => {
            const out = await api.endAway(user.id, person.id);
            await refresh();
            return out;
          }}
        />
      ) : (
        <WorkflowForm
          label={self ? "I'm away" : `Mark ${person.full_name} as away`}
          success="Marked as away. Waiting approvals moved to the delegate."
          run={async (fields) => {
            const note = value(fields, "note");
            const out = await api.startAway(user.id, person.id, {
              delegate_user_id: value(fields, "delegate"),
              note: note || null,
            });
            await refresh();
            return out;
          }}
        >
          <Choice
            label="Delegate"
            name="delegate"
            options={candidates.map((p) => ({ value: p.id, label: `${p.full_name} · ${p.title}` }))}
          />
          <Field label="Note (optional)" name="note" required={false} />
        </WorkflowForm>
      )}
    </div>
  );
}
