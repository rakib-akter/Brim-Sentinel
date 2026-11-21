import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/sentinel/empty-state";
import { InvoiceTable } from "@/components/sentinel/invoice-table";
import { PageHeader } from "@/components/sentinel/page-header";
import { errorMessage } from "@/components/sentinel/workflow-form";
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
      {result.error ? (
        <p role="alert">{errorMessage(result.error)}</p>
      ) : result.isPending ? (
        <p role="status">Loading approvals…</p>
      ) : (
        <>
          <section className="surface overflow-hidden">
            <h2 className="border-b px-5 py-3 font-semibold">Ready for your decision</h2>
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
