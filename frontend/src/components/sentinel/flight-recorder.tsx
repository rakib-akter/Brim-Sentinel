import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Ban,
  Check,
  Circle,
  FastForward,
  FileText,
  Flag,
  Landmark,
  type LucideIcon,
  Pencil,
  Play,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

const EVENT_ICON: Array<[RegExp, LucideIcon, string]> = [
  [/^investigation\./, Sparkles, "bg-primary-soft text-primary"],
  [/^approval\.approved/, Check, "bg-success-soft text-success-foreground"],
  [/^approval\.rejected/, X, "bg-critical-soft text-critical-foreground"],
  [/^payment\./, Wallet, "bg-success-soft text-success-foreground"],
  [/^bank_change\.|^card_route\./, Landmark, "bg-warning-soft text-warning-foreground"],
  [/^case\./, Flag, "bg-warning-soft text-warning-foreground"],
  [/^invoice\.received/, Upload, "bg-secondary text-foreground"],
  [/^invoice\.extracted/, FileText, "bg-secondary text-foreground"],
  [/^invoice\.validated/, ShieldCheck, "bg-secondary text-foreground"],
  [/^coding\.|^finding\./, Pencil, "bg-secondary text-foreground"],
  [/^user\.|^policy\./, UserRound, "bg-secondary text-foreground"],
];

function iconFor(action: string, result: string | null): [LucideIcon, string] {
  if (result === "DENIED") return [Ban, "bg-critical-soft text-critical-foreground"];
  const hit = EVENT_ICON.find(([re]) => re.test(action));
  return hit ? [hit[1], hit[2]] : [Circle, "bg-secondary text-muted-foreground"];
}

/** The payment journey: every persisted event as a timeline, with a step-by-step replay. */
export function FlightRecorder({ invoiceId }: { invoiceId: string }) {
  const { user } = useSession();
  const { data, error, isPending } = useQuery(flightQuery(user.id, invoiceId));
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<number | null>(null); // null = everything visible
  useEffect(() => {
    if (window.location.hash === "#explain") setOpen(true);
  }, []);
  const total = data?.events.length ?? 0;
  useEffect(() => {
    if (shown === null || shown >= total) return;
    const t = window.setTimeout(() => setShown((n) => (n === null ? null : n + 1)), 450);
    return () => window.clearTimeout(t);
  }, [shown, total]);
  const visible = data ? data.events.slice(0, shown ?? total) : [];
  const replaying = shown !== null && shown < total;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CollapsibleTrigger className="text-sm font-semibold text-primary">
          See payment journey
        </CollapsibleTrigger>
        {open && total > 1 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShown(replaying ? null : 0)}
            aria-label={replaying ? "Show all events" : "Replay the payment journey step by step"}
          >
            {replaying ? <FastForward aria-hidden /> : <Play aria-hidden />}
            {replaying ? "Show all" : "Replay"}
          </Button>
        )}
      </div>
      <CollapsibleContent className="mt-4 space-y-4">
        {error && <p role="alert">{errorMessage(error)}</p>}
        {isPending && <p role="status">Loading activity…</p>}
        {data && (
          <>
            <h3 className="text-sm font-semibold">
              Recorded events{" "}
              <span className="font-normal text-muted-foreground">
                · {replaying ? `${visible.length} of ${total}` : total}
              </span>
            </h3>
            {!data.events.length && <p className="text-sm">No recorded events.</p>}
            <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-border">
              {visible.map((event) => {
                const [Icon, tone] = iconFor(event.action, event.result);
                return (
                  <li key={event.id} className="rise-in relative flex gap-3 text-sm">
                    <span
                      className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-card ${tone}`}
                    >
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="font-medium leading-snug">
                        <span>{event.label}</span>{" "}
                        <span className="font-normal text-muted-foreground">
                          by {event.actor_name ?? event.actor_id ?? "Sentinel"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(event.occurred_at, { dateStyle: "medium", timeStyle: "short" })}
                        {isNotableResult(event.result) && <> · {plain(event.result)}</>}
                      </p>
                      {event.before_state && event.after_state && (
                        <p className="mt-0.5 text-xs">
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
                        <details className="text-xs">
                          <summary className="cursor-pointer text-primary">See evidence</summary>
                          <Evidence items={event.evidence_refs} />
                        </details>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {data.proposed_next.length > 0 && !replaying && (
              <section className="fade-in rounded-md border border-dashed p-3 text-sm">
                <h3 className="font-semibold">Proposed next steps (not yet done)</h3>
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
