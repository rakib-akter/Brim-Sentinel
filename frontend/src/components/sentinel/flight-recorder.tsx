import { useQuery } from "@tanstack/react-query";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { flightQuery } from "@/lib/api/queries";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { errorMessage } from "./workflow-form";

export function Evidence({ items }: { items: unknown[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
      {items.map((item, i) => (
        <li key={i} className="break-all">
          {typeof item === "string" ? item : JSON.stringify(item)}
        </li>
      ))}
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
                    {formatDate(event.occurred_at, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {event.result}
                  </p>
                  {event.before_state && event.after_state && (
                    <p>
                      {event.before_state} → {event.after_state}
                    </p>
                  )}
                  {event.policy_ids.length > 0 && <p>Policy {event.policy_ids.join(", ")}</p>}
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
