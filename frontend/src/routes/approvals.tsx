import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Clock3, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/sentinel/empty-state";
import { InvoiceTable } from "@/components/sentinel/invoice-table";
import { PageHeader } from "@/components/sentinel/page-header";
import { QueryState } from "@/components/sentinel/query-state";
import { invoicesQuery } from "@/lib/api/queries";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/approvals")({
  head: () => ({ meta: [{ title: "Approvals — Brim Sentinel" }] }),
  loader: async ({ context }) => {
    await context.queryClient.prefetchQuery(invoicesQuery(context.actor, { status: "approval" }));
  },
  component: Approvals,
});

function Approvals() {
  const { user } = useSession();
  const result = useQuery(invoicesQuery(user.id, { status: "approval" }));
  const tasks = result.data ?? [];
  const assigned = tasks.filter((task) => task.record?.allowed_actions.includes("approve"));
  const waiting = tasks.filter((task) => !assigned.includes(task));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work"
        title="Approvals"
        description="Review pending decisions and follow the approval chain on each invoice."
      />
      {!result.isPending && !result.error && <div className="grid gap-3 sm:grid-cols-3"><SummaryTile icon={ShieldCheck} label="Ready for your decision" value={assigned.length} detail="Actions available to your role" /><SummaryTile icon={Clock3} label="Other pending approvals" value={waiting.length} detail="Awaiting another decision" /><SummaryTile icon={CheckSquare} label="Total awaiting approval" value={tasks.length} detail="Visible in your workspace" /></div>}
      {result.error || result.isPending ? (
        <div className="surface">
          <QueryState error={result.error} loading="Loading approvals…" retry={result.refetch} />
        </div>
      ) : (
        <>
          <section className="surface overflow-hidden">
            <h2 className="border-b border-border/80 px-6 py-5 text-[15px] font-semibold tracking-tight">Ready for your decision</h2>
            {assigned.length ? (
              <InvoiceTable tasks={assigned} caption="Ready for your decision" />
            ) : (
              <EmptyState
                icon={CheckSquare}
                title="No approvals assigned to you"
                body="Invoices appear here when your approval step becomes active."
              />
            )}
          </section>
          {waiting.length > 0 && (
            <section className="surface overflow-hidden">
              <h2 className="border-b px-5 py-3 font-semibold">Other visible approvals</h2>
              <InvoiceTable tasks={waiting} caption="Other visible approvals" />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value, detail }: { icon: typeof CheckSquare; label: string; value: number; detail: string }) { return <div className="surface flex items-start gap-3 p-5"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="size-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="figure mt-1 text-[27px] font-semibold tracking-tight">{value}</p><p className="text-[11px] text-muted-foreground">{detail}</p></div></div>; }
