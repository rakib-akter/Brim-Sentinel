import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/sentinel/page-header";
import { ResolutionCase } from "@/components/sentinel/resolution-case";
import { QueryState } from "@/components/sentinel/query-state";
import { humanize } from "@/components/sentinel/workflow-form";
import { caseQuery, casesQuery } from "@/lib/api/queries";
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
      deps.caseId
        ? context.queryClient.prefetchQuery(caseQuery(context.actor, deps.caseId))
        : undefined,
    ]);
  },
  head: () => ({ meta: [{ title: "Investigations — Brim Sentinel" }] }),
  component: Investigations,
});

function Investigations() {
  const { user } = useSession();
  const search = Route.useSearch();
  const cases = useQuery(casesQuery(user.id, !search.history));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oversight"
        title="Investigations"
        description="Review evidence and track the Path to Pay for each resolution case."
      />
      {search.caseId && <ResolutionCase key={search.caseId} id={search.caseId} />}
      <section className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">{search.history ? "All cases" : "Open cases"}</h2>
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
          <p className="p-5 text-sm text-muted-foreground">No cases in this view.</p>
        )}
        <ul className="divide-y">
          {cases.data?.items.map((item) => (
            <li key={item.id} className="px-5 py-3 text-sm">
              <Link
                className="font-medium text-primary hover:underline"
                to="/investigations"
                search={{ ...search, caseId: item.id }}
              >
                {item.title}
              </Link>
              <p className="text-muted-foreground">
                {item.id} · {item.invoice_id} · {humanize(item.state)} ·{" "}
                {item.owner_id ?? humanize(item.owner_role)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
