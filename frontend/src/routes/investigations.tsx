import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldAlert, ShieldCheck, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/sentinel/money";
import { PageHeader } from "@/components/sentinel/page-header";
import { ResolutionCase } from "@/components/sentinel/resolution-case";
import { QueryState } from "@/components/sentinel/query-state";
import { humanize } from "@/components/sentinel/workflow-form";
import { caseQuery, casesQuery, invoicesQuery } from "@/lib/api/queries";
import type { CaseSummary } from "@/lib/api/schema";
import { SEVERITY_STYLE, sortCases } from "@/lib/cases";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/investigations")({
  validateSearch: (search: Record<string, unknown>) => ({
    caseId: typeof search["caseId"] === "string" ? search["caseId"] : undefined,
    history: search["history"] === true ? true : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(casesQuery(context.actor, !deps.history)),
      context.queryClient.prefetchQuery(invoicesQuery(context.actor, { includeHistory: true })),
      deps.caseId
        ? context.queryClient.prefetchQuery(caseQuery(context.actor, deps.caseId))
        : undefined,
    ]);
  },
  head: () => ({ meta: [{ title: "Investigations — Brim Sentinel" }] }),
  component: Investigations,
});

function Investigations() {
  const { user, users } = useSession();
  const search = Route.useSearch();
  const cases = useQuery(casesQuery(user.id, !search.history));
  const invoices = useQuery(invoicesQuery(user.id, { includeHistory: true }));
  const byInvoice = new Map((invoices.data ?? []).map((t) => [t.invoice.id, t.invoice]));
  const items = sortCases(cases.data?.items ?? []);
  const ownerName = (item: CaseSummary) =>
    item.owner_id
      ? (users.find((u) => u.id === item.owner_id)?.name ?? humanize(item.owner_role))
      : humanize(item.owner_role);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oversight"
        title="Investigations"
        description="Every open exception with its evidence and the safe path to pay. Most severe first."
      />
      {cases.data && <div className="grid gap-3 sm:grid-cols-3"><CaseStat icon={ClipboardList} label="Visible cases" value={items.length} note={search.history ? "Including historical cases" : "Open investigations"} /><CaseStat icon={ShieldAlert} label="High severity" value={items.filter((item) => item.severity === "high").length} note="Prioritize for review" /><CaseStat icon={ShieldCheck} label="Linked invoices" value={new Set(items.map((item) => item.invoice_id)).size} note="Distinct invoice records" /></div>}
      {search.caseId && <ResolutionCase key={search.caseId} id={search.caseId} />}
      <section className="surface overflow-hidden" aria-labelledby="cases-heading">
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-5">
          <h2 id="cases-heading" className="font-semibold">
            {search.history ? "All cases" : "Open cases"}
            {cases.data && (
              <span className="figure ml-2 rounded-full bg-secondary px-2 py-px text-xs font-medium text-muted-foreground">
                {items.length}
              </span>
            )}
          </h2>
          <Link
            className="text-sm font-medium text-primary hover:underline"
            to="/investigations"
            search={{ ...search, history: search.history ? undefined : true }}
          >
            {search.history ? "Open cases only" : "Include case history"}
          </Link>
        </div>
        {(cases.error || cases.isPending) && (
          <QueryState error={cases.error} loading="Loading cases…" retry={cases.refetch} />
        )}
        {cases.data?.items.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">
            No open cases. Sentinel opens one whenever a check pauses a payment.
          </p>
        )}
        <ul className="max-h-[min(58vh,560px)] divide-y overflow-y-auto overscroll-contain" role="region" aria-label="Investigation cases" tabIndex={0}>
          {items.map((item) => {
            const inv = byInvoice.get(item.invoice_id);
            const sev = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE["low"]!;
            const selected = search.caseId === item.id;
            return (
              <li
                key={item.id}
                className={`relative flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-5 transition-colors hover:bg-secondary/35 ${selected ? "bg-primary-soft/40" : ""}`}
              >
                <span
                  className={`absolute inset-y-3 left-0 w-[3px] rounded-r ${sev.rail}`}
                  aria-hidden
                />
                <div className="min-w-[16rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="text-sm font-medium text-foreground hover:underline"
                      to="/investigations"
                      search={{ ...search, caseId: item.id }}
                      aria-current={selected ? "true" : undefined}
                    >
                      {item.title}
                    </Link>
                    <span className={`rounded-full px-2 py-px text-[11px] font-medium ${sev.chip}`}>
                      {sev.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {inv ? (
                      <>
                        {inv.supplierName}
                        <span className="figure"> · #{inv.number ?? item.invoice_id}</span>
                      </>
                    ) : (
                      <>Invoice {item.invoice_id}</>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {humanize(item.state)} · Next: {ownerName(item)}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-4">
                  {inv && (
                    <Money
                      minor={inv.totalMinor}
                      currency={inv.currency}
                      className="whitespace-nowrap text-sm font-medium"
                    />
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/invoices/$invoiceId" params={{ invoiceId: item.invoice_id }}>
                      Review case <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function CaseStat({ icon: Icon, label, value, note }: { icon: typeof ClipboardList; label: string; value: number; note: string }) { return <div className="surface flex items-start gap-3 p-5"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="size-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="figure mt-1 text-[27px] font-semibold tracking-tight">{value}</p><p className="text-[11px] text-muted-foreground">{note}</p></div></div>; }
