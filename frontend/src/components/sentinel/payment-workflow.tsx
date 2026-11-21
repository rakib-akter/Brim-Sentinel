import { Money } from "./money";
import { SimulatedTag } from "./badges";
import { Choice, humanize, value, WorkflowForm } from "./workflow-form";
import { api } from "@/lib/api/client";
import type { InvoiceDetail, PaymentOut } from "@/lib/api/schema";
import { useSession } from "@/lib/session";

export function PaymentRecord({ payment }: { payment: PaymentOut }) {
  return (
    <dl className="space-y-1 text-sm">
      <dt className="font-medium">
        {humanize(payment.state)} · {payment.method} {payment.simulation && <SimulatedTag />}
      </dt>
      <dd>
        <Money minor={payment.amount_minor} currency={payment.currency} />
      </dd>
      {payment.scheduled_date && <dd>Scheduled for {payment.scheduled_date}</dd>}
      {payment.route_id && <dd>Route {payment.route_id}</dd>}
      {payment.reference && <dd>Reference {payment.reference}</dd>}
      {payment.prepared_by_id && <dd>Prepared by {payment.prepared_by_id}</dd>}
      {payment.released_by_id && <dd>Released by {payment.released_by_id}</dd>}
    </dl>
  );
}

export function PaymentWorkflow({ invoice }: { invoice: InvoiceDetail }) {
  const { user } = useSession();
  const payment = invoice.payment_summary;
  const allowed = invoice.allowed_actions;
  return (
    <section id="payment" className="surface space-y-4 px-5 py-4">
      <h2 className="text-sm font-semibold">
        Payment <SimulatedTag />
      </h2>
      {payment ? (
        <PaymentRecord payment={payment} />
      ) : (
        <p className="text-sm text-muted-foreground">No payment recorded.</p>
      )}
      {allowed.includes("prepare_payment") && (
        <WorkflowForm
          label="Schedule simulated payment"
          run={(fields) => {
            const method = value(fields, "method");
            return api.prepare(user.id, {
              invoice_id: invoice.id,
              expected_version: invoice.version,
              method: method === "EFT" || method === "CARD" || method === "CHEQUE" ? method : null,
            });
          }}
        >
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Payment route options</summary>
            <Choice
              name="method"
              label="Payment method (optional, defaults to the invoice route)"
              required={false}
              options={["EFT", "CARD", "CHEQUE"].map((method) => ({
                value: method,
                label: method,
              }))}
            />
          </details>
        </WorkflowForm>
      )}
      {payment?.simulation && allowed.includes("release_payment") && (
        <WorkflowForm
          label="Release simulated payment"
          run={() =>
            api.release(
              user.id,
              payment.id,
              { expected_invoice_version: invoice.version },
              `ui-release-${payment.id}-v${invoice.version}`,
            )
          }
        />
      )}
      {payment?.simulation && allowed.includes("simulate_settlement") && (
        <WorkflowForm
          label="Record simulated settlement"
          run={(fields) =>
            api.settle(user.id, payment.id, {
              outcome: value(fields, "outcome") === "FAILED" ? "FAILED" : "SETTLED",
            })
          }
        >
          <Choice
            label="Outcome"
            name="outcome"
            options={[
              { value: "SETTLED", label: "Settled" },
              { value: "FAILED", label: "Failed" },
            ]}
          />
        </WorkflowForm>
      )}
      {payment?.state === "SCHEDULED" && !allowed.includes("release_payment") && (
        <p className="text-sm text-muted-foreground">
          Waiting for an eligible independent releaser.
        </p>
      )}
    </section>
  );
}
