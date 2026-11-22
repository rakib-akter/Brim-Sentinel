import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { flightQuery } from "@/lib/api/queries";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import {
  evidenceLabel,
  evidenceTarget,
  isNotableResult,
  plain,
  policyLabel,
} from "@/lib/plain-language";
import { errorMessage } from "./workflow-form";

/** Evidence references as readable lines; invoices and suppliers open in the app. */
export function Evidence({ items }: { items: unknown[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
      {items.map((item, i) => {
        const target = evidenceTarget(item);
        const label = evidenceLabel(item);
        return (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden>•</span>
            {target?.kind === "invoice" ? (
              <Link
                className="text-primary hover:underline"
                to="/invoices/$invoiceId"
                params={{ invoiceId: target.invoiceId }}
              >
                {label}
              </Link>
            ) : target?.kind === "vendor" ? (
              <Link
                className="text-primary hover:underline"
                to="/vendors"
                search={{ vendorId: target.vendorId, q: "", status: "" }}
              >
                {label}
              </Link>
            ) : (
              <span>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function FlightRecorder({ invoiceId }: { invoiceId: string }) {
  const { user } = useSession();
  const { data, error, isPending } = useQuery(flightQuery(user.id, invoiceId));
  return (
    <Collapsible className="surface px-5 py-4">
      <CollapsibleTrigger className="text-sm font-semibold text-primary">
        See payment journey
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4 space-y-4">
        {error && <p role="alert">{errorMessage(error)}</p>}
        {isPending && <p role="status">Loading activity…</p>}
        {data && (
          <>
            <h3 className="text-sm font-semibold">Recorded events</h3>
            {!data.events.length && <p className="text-sm">No recorded events.</p>}
            <ol className="space-y-3 border-l pl-4">
              {data.events.map((event) => (
                <li key={event.id} className="text-sm">
                  <p className="font-medium">{event.label}</p>
                  <p className="text-muted-foreground">
                    {event.actor_name ?? event.actor_id ?? "System"} ·{" "}
                    {formatDate(event.occurred_at, { dateStyle: "medium", timeStyle: "short" })}
                    {isNotableResult(event.result) && <> · {plain(event.result)}</>}
                  </p>
                  {event.before_state && event.after_state && (
                    <p>
                      {plain(event.before_state)} → {plain(event.after_state)}
                    </p>
                  )}
                  {event.policy_ids.length > 0 && (
                    <ul className="text-xs text-muted-foreground">
                      {event.policy_ids.map((id) => (
                        <li key={id}>{policyLabel(id)}</li>
                      ))}
                    </ul>
                  )}
                  {event.evidence_refs.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-primary">See evidence</summary>
                      <Evidence items={event.evidence_refs} />
                    </details>
                  )}
                </li>
              ))}
            </ol>
            {data.proposed_next.length > 0 && (
              <section className="rounded-md border border-dashed p-3 text-sm">
                <h3 className="font-semibold">Proposed next steps</h3>
                <ul className="mt-1 list-inside list-disc">
                  {data.proposed_next.map((event) => (
                    <li key={event.id}>{event.label}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
