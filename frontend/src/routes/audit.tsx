import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/sentinel/page-header";
import { QueryState } from "@/components/sentinel/query-state";
import { Evidence } from "@/components/sentinel/flight-recorder";
import { downloadFile, Field, value, WorkflowForm } from "@/components/sentinel/workflow-form";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { meQuery } from "@/lib/api/queries";
import { formatDate } from "@/lib/format";
import { actionLabel, describeData, isNotableResult, plain } from "@/lib/plain-language";
import { useSession } from "@/lib/session";

const PAGE_SIZE = 40;
const FILTERS = ["invoice_id", "actor_id", "action"] as const;
const auditQuery = (actor: string, query: string, offset: number) =>
  queryOptions({
    queryKey: ["audit", actor, query, offset],
    queryFn: () => {
      const params = new URLSearchParams(query);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      return api.audit(actor, params);
    },
  });

export const Route = createFileRoute("/audit")({
  head: () => ({ meta: [{ title: "Audit Trail — Brim Sentinel" }] }),
  loader: async ({ context }) => {
    const identity = context.queryClient.getQueryData(meQuery(context.actor).queryKey);
    if (identity?.permissions.includes("audit.read_all")) {
      await context.queryClient.prefetchQuery(auditQuery(context.actor, "", 0));
    }
  },
  component: Audit,
});

function Audit() {
  const { permissions } = useSession();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oversight"
        title="Audit Trail"
        description="Review recorded actions, decisions and denied attempts."
      />
      {permissions.includes("audit.read_all") ? (
        <AuditEvents />
      ) : (
        <p role="alert" className="surface p-5 text-sm">
          Audit Trail access requires an authorized demo role.
        </p>
      )}
    </div>
  );
}

function AuditEvents() {
  const { user, users, permissions } = useSession();
  const [filters, setFilters] = useState("");
  const [initial, setInitial] = useState<URLSearchParams | null>(null);
  const [offset, setOffset] = useState(0);
  // Honour filters in the URL (shared links, or a form submitted before the page hydrated).
  useEffect(() => {
    const url = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    for (const name of FILTERS) {
      const term = url.get(name)?.trim();
      if (term) params.set(name, term);
    }
    if (params.size) {
      setInitial(params);
      setFilters(params.toString());
    }
  }, []);
  const [chain, setChain] = useState<Awaited<ReturnType<typeof api.verifyAudit>>>();
  const events = useQuery(auditQuery(user.id, filters, offset));
  return (
    <>
      <section className="surface space-y-5 px-6 py-6">
        <form
          key={initial?.toString() ?? ""}
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const params = new URLSearchParams();
            for (const name of FILTERS) {
              const term = value(data, name);
              if (term) params.set(name, term);
            }
            setOffset(0);
            setFilters(params.toString());
          }}
        >
          <Field
            label="Invoice ID"
            name="invoice_id"
            required={false}
            defaultValue={initial?.get("invoice_id") ?? ""}
          />
          <Field
            label="Actor ID"
            name="actor_id"
            required={false}
            defaultValue={initial?.get("actor_id") ?? ""}
          />
          <Field
            label="Action prefix"
            name="action"
            required={false}
            defaultValue={initial?.get("action") ?? ""}
          />
          <Button type="submit">Apply filters</Button>
        </form>
        <div className="flex flex-wrap items-center gap-3 border-t border-border/80 pt-4">
          <WorkflowForm
            label="Verify hash chain"
            refresh={false}
            success=""
            run={async () => {
              setChain(undefined);
              setChain(await api.verifyAudit(user.id));
            }}
          />
          {permissions.includes("audit.export") && (
            <WorkflowForm
              label="Download filtered CSV"
              refresh={false}
              success=""
              run={async () =>
                downloadFile(
                  await api.exportAudit(user.id, new URLSearchParams(filters)),
                  "brim_audit.csv",
                )
              }
            />
          )}
        </div>
        {chain && (
          <p role="status" className="text-sm">
            {chain.valid
              ? "Hash chain valid"
              : `Hash mismatch at event ${chain.broken_at_event_id ?? "unknown"}`}{" "}
            · {chain.events_checked} events checked
          </p>
        )}
      </section>
      <section className="surface overflow-hidden">
        {(events.error || events.isPending) && (
          <QueryState error={events.error} loading="Loading audit events…" retry={events.refetch} />
        )}
        {events.data && (
          <>
            {events.data.items.length === 0 && (
              <p className="p-5 text-sm text-muted-foreground">
                No audit events match these filters.
              </p>
            )}
            <ul className="max-h-[min(58vh,560px)] divide-y overflow-y-auto overscroll-contain" role="region" aria-label="Audit events" tabIndex={0}>
              {events.data.items.map((event) => (
                <li key={event.id} className="px-6 py-5 text-sm transition-colors hover:bg-secondary/30">
                  <p className="font-medium">
                    {actionLabel(event.action)}
                    {isNotableResult(event.result) && ` · ${plain(event.result)}`}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDate(event.occurred_at, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {event.actor_id
                      ? (users.find((u) => u.id === event.actor_id)?.name ?? event.actor_id)
                      : "Sentinel (system)"}
                    {event.invoice_id && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          className="text-primary hover:underline"
                          to="/invoices/$invoiceId"
                          params={{ invoiceId: event.invoice_id }}
                        >
                          {event.invoice_id}
                        </Link>
                      </>
                    )}
                  </p>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer">Event details</summary>
                    <p className="mt-2">
                      {event.action} · {event.object_type} {event.object_id}
                      {event.object_version != null && ` · version ${event.object_version}`}
                    </p>
                    {event.before_state && event.after_state && (
                      <p>
                        {event.before_state} → {event.after_state}
                      </p>
                    )}
                    {event.policy_ids.length > 0 && <p>Policy {event.policy_ids.join(", ")}</p>}
                    <Evidence items={event.evidence_refs} />
                    <ul>
                      {describeData(event.details ?? {}).map((line) => (
                        <li key={line} className="break-all">
                          {line}
                        </li>
                      ))}
                    </ul>
                    <p className="break-all">Hash {event.hash}</p>
                  </details>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 px-6 py-4 text-sm">
              <span>
                {events.data.total ? offset + 1 : 0}–{offset + events.data.items.length} of{" "}
                {events.data.total} events
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!offset}
                  onClick={() => setOffset(offset - PAGE_SIZE)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset + PAGE_SIZE >= events.data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
