import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { InvoiceTable } from "@/components/sentinel/invoice-table";
import { PageHeader } from "@/components/sentinel/page-header";
import { PaymentRecord } from "@/components/sentinel/payment-workflow";
import { errorMessage, humanize } from "@/components/sentinel/workflow-form";
import { invoicesQuery, paymentsQuery } from "@/lib/api/queries";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/payments")({
  head: () => ({ meta: [{ title: "Payments — Brim Sentinel" }] }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(paymentsQuery(context.actor, "")),
      context.queryClient.prefetchQuery(invoicesQuery(context.actor, {})),
    ]);
  },
  component: Payments,
});

function Payments() {
  const { user } = useSession();
  const [state, setState] = useState("");
  const payments = useQuery(paymentsQuery(user.id, state));
  const invoices = useQuery(invoicesQuery(user.id, {}));
  const pending = (invoices.data ?? []).filter(({ invoice }) =>
    ["approved", "on_hold"].includes(invoice.status),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work"
        title="Payments"
        description="Track holds, scheduling, release and settlement for simulated payments."
      />
      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="font-semibold">Simulated payment records</h2>
          <label className="flex items-center gap-2 text-sm">
            State
            <select
              className="rounded-md border bg-background p-2"
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="">All</option>
              {["SCHEDULED", "RELEASED", "SETTLED", "FAILED", "CANCELLED"].map((status) => (
                <option key={status} value={status}>
                  {humanize(status)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {payments.error && (
          <p className="p-5" role="alert">
            {errorMessage(payments.error)}
          </p>
        )}
        {payments.isPending && (
          <p className="p-5" role="status">
            Loading payment records…
          </p>
        )}
        {payments.data?.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">No payment records match this view.</p>
        )}
        <ul className="divide-y">
          {payments.data?.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
            >
              <PaymentRecord payment={payment} />
              <Link
                className="text-sm font-medium text-primary hover:underline"
                to="/invoices/$invoiceId"
                params={{ invoiceId: payment.invoice_id }}
                hash="payment"
              >
                Review {payment.invoice_id}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {invoices.error && <p role="alert">{errorMessage(invoices.error)}</p>}
      {pending.length > 0 && (
        <section className="surface overflow-hidden">
          <h2 className="border-b px-5 py-3 font-semibold">Held and ready to schedule</h2>
          <InvoiceTable tasks={pending} caption="Invoices held or ready to schedule" />
        </section>
      )}
    </div>
  );
}
