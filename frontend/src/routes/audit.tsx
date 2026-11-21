import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/sentinel/page-header";
import { QueryState } from "@/components/sentinel/query-state";
import { Evidence } from "@/components/sentinel/flight-recorder";
import {
  downloadFile,
  Field,
  humanize,
  value,
  WorkflowForm,
} from "@/components/sentinel/workflow-form";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { meQuery } from "@/lib/api/queries";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";

const PAGE_SIZE = 40;
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
  const { user, permissions } = useSession();
  const [filters, setFilters] = useState("");
  const [offset, setOffset] = useState(0);
  const [chain, setChain] = useState<Awaited<ReturnType<typeof api.verifyAudit>>>();
  const events = useQuery(auditQuery(user.id, filters, offset));
  return (
    <>
      <section className="surface space-y-4 px-5 py-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const params = new URLSearchParams();
            for (const name of ["invoice_id", "actor_id", "action"]) {
              const term = value(data, name);
              if (term) params.set(name, term);
            }
            setOffset(0);
            setFilters(params.toString());
          }}
        >
          <Field label="Invoice ID" name="invoice_id" required={false} />
          <Field label="Actor ID" name="actor_id" required={false} />
          <Field label="Action prefix" name="action" required={false} />
          <Button type="submit">Apply filters</Button>
        </form>
        <div className="flex flex-wrap gap-3">
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
            <ul className="divide-y">
              {events.data.items.map((event) => (
                <li key={event.id} className="px-5 py-3 text-sm">
                  <p className="font-medium">
                    {humanize(event.action.replaceAll(".", " · "))} · {humanize(event.result)}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDate(event.occurred_at, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {event.actor_id ?? event.actor_kind}
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
                    <Evidence items={[...event.evidence_refs, event.details]} />
                    <p className="break-all">Hash {event.hash}</p>
                  </details>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-sm">
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
