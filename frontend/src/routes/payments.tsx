import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Wallet, ShieldAlert, CheckCircle2 } from "lucide-react";
import { InvoiceTable } from "@/components/sentinel/invoice-table";
import { PageHeader } from "@/components/sentinel/page-header";
import { PaymentRecord } from "@/components/sentinel/payment-workflow";
import { QueryState } from "@/components/sentinel/query-state";
import { humanize } from "@/components/sentinel/workflow-form";
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
      <div className="grid gap-3 sm:grid-cols-3"><PaymentStat icon={Wallet} label="Payment records" value={payments.data?.length ?? 0} note={state ? "Matching selected state" : "Visible payment history"} /><PaymentStat icon={CheckCircle2} label="Ready to schedule" value={pending.filter(({ invoice }) => invoice.status === "approved").length} note="Approved invoices" /><PaymentStat icon={ShieldAlert} label="On hold" value={pending.filter(({ invoice }) => invoice.status === "on_hold").length} note="Payment safeguards active" /></div>
      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-6 py-5">
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
        {(payments.error || payments.isPending) && (
          <QueryState
            error={payments.error}
            loading="Loading payment records…"
            retry={payments.refetch}
          />
        )}
        {payments.data?.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">No payment records match this view.</p>
        )}
        <ul className="divide-y">
          {payments.data?.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 transition-colors hover:bg-secondary/30"
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
      {(invoices.error || invoices.isPending) && (
        <div className="surface">
          <QueryState
            error={invoices.error}
            loading="Loading invoices for payment…"
            retry={invoices.refetch}
          />
        </div>
      )}
      {pending.length > 0 && (
        <section className="surface overflow-hidden">
          <h2 className="border-b border-border/80 px-6 py-5 text-[15px] font-semibold tracking-tight">Held and ready to schedule</h2>
          <InvoiceTable tasks={pending} caption="Invoices held or ready to schedule" />
        </section>
      )}
    </div>
  );
}

function PaymentStat({ icon: Icon, label, value, note }: { icon: typeof Wallet; label: string; value: number; note: string }) { return <div className="surface flex items-start gap-3 p-5"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="size-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="figure mt-1 text-[27px] font-semibold tracking-tight">{value}</p><p className="text-[11px] text-muted-foreground">{note}</p></div></div>; }
