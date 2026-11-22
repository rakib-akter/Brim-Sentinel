import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Lightbulb,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api } from "@/lib/api/client";
import type { InvestigationOut } from "@/lib/api/schema";
import { lookupLabel, plain, plainSentence } from "@/lib/plain-language";
import { useSession } from "@/lib/session";
import { EvidenceDrawer } from "./evidence-drawer";
import { errorMessage } from "./workflow-form";

/** How the answer was produced, from fields the backend returned. Never guessed. */
export function investigationMode(out: Pick<InvestigationOut, "source" | "replayed">): {
  key: "live" | "recorded" | "fallback";
  label: string;
  detail: string;
} {
  if (out.source === "model" && out.replayed)
    return {
      key: "recorded",
      label: "Recorded demo",
      detail: "Replayed from a recorded AI run, then fact-checked against today's evidence.",
    };
  if (out.source === "model")
    return {
      key: "live",
      label: "Live AI",
      detail: "Written by the AI model just now and fact-checked against the evidence.",
    };
  return {
    key: "fallback",
    label: "Deterministic fallback",
    detail: "Built from rule results without an AI model.",
  };
}

const MODE_STYLE = {
  live: "bg-primary text-primary-foreground",
  recorded: "bg-info-soft text-info-foreground",
  fallback: "bg-secondary text-foreground",
} as const;

const CANNOT =
  "It can read records and explain them. It can't verify bank details, approve, release a payment or lift the hold.";

/** Slow-response threshold after which we say so plainly (no fake progress). */
const SLOW_MS = 12_000;

/* ------------------------------------------------------------------ message bubbles */

type Speaker = "checks" | "ai" | "person";

const AVATAR: Record<Speaker, string> = {
  checks: "bg-secondary text-foreground",
  ai: "bg-primary text-primary-foreground",
  person: "bg-success-soft text-success-foreground",
};
const BUBBLE: Record<Speaker, string> = {
  checks: "bg-secondary/70",
  ai: "bg-primary-soft/60",
  person: "border bg-card",
};

export function Message({
  speaker,
  name,
  initials,
  tag,
  time,
  children,
}: {
  speaker: Speaker;
  name: string;
  initials?: string;
  tag?: ReactNode;
  time?: string | null;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${AVATAR[speaker]}`}
        aria-hidden
      >
        {speaker === "ai" ? (
          <Sparkles className="size-4" />
        ) : speaker === "checks" ? (
          <ShieldCheck className="size-4" />
        ) : (
          initials
        )}
      </span>
      <div className={`min-w-0 max-w-[46rem] flex-1 rounded-2xl px-4 py-3 ${BUBBLE[speaker]}`}>
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {name}
          {tag}
        </p>
        <div className="mt-1 space-y-2 text-sm leading-relaxed">{children}</div>
        {time && <p className="mt-2 text-[11px] text-muted-foreground">{time}</p>}
      </div>
    </li>
  );
}

export const clock = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`))
    : null;

/* ------------------------------------------------------------------ AI turn */

/**
 * Sentinel AI's part of the case thread. The backend returns one completed result, so while it runs
 * the thread shows a plain "reading" bubble; the lookups appear only after the backend reports
 * them. Suggestions are only suggestions: the hold is never changed here.
 */
export function SentinelAiTurn({ caseId }: { caseId: string }) {
  const { user } = useSession();
  const cache = useQueryClient();
  const [slow, setSlow] = useState(false);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api.investigate(user.id, caseId),
    retry: false,
    onSuccess: () => {
      setFinishedAt(new Date().toISOString());
      // New lookups are audit events, so refresh the payment journey and graph.
      return cache.invalidateQueries({ queryKey: ["flight", user.id] });
    },
  });
  useEffect(() => {
    if (!run.isPending) return setSlow(false);
    const t = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(t);
  }, [run.isPending]);
  if (user.role === "requester") return null;

  return (
    <>
      {run.isPending && (
        <Message speaker="ai" name="Sentinel AI">
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <span className="typing-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            Reading the records this case is allowed to see…
          </p>
          {slow && (
            <p className="text-xs text-muted-foreground">
              This is taking longer than usual. You can keep working and come back.
            </p>
          )}
        </Message>
      )}
      {run.error && !run.isPending && (
        <Message speaker="ai" name="Sentinel AI">
          <p role="alert">
            I couldn't finish: {errorMessage(run.error)} Nothing on the case was changed.
          </p>
        </Message>
      )}
      {run.data && !run.isPending && (
        <AiAnswer key={run.submittedAt} out={run.data} time={clock(finishedAt)} />
      )}
      <li className="pl-12">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed px-4 py-3">
          <Button
            size="sm"
            variant={run.data ? "outline" : "default"}
            onClick={() => run.mutate()}
            disabled={run.isPending}
          >
            {run.data || run.error ? <RotateCcw aria-hidden /> : <Sparkles aria-hidden />}
            {run.isPending
              ? "Investigating…"
              : run.data || run.error
                ? "Ask again"
                : "Ask Sentinel AI to explain this case"}
          </Button>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{CANNOT}</p>
        </div>
      </li>
    </>
  );
}

function AiAnswer({ out, time }: { out: InvestigationOut; time: string | null }) {
  const [openRef, setOpenRef] = useState<string | null>(null);
  const cited = out.lookups.filter((l) => out.evidence.includes(String(l["ref"])));
  const evidence = cited.length ? cited : out.lookups;
  const open = out.lookups.find((l) => String(l["ref"]) === openRef);
  const mode = investigationMode(out);
  const tag = (
    <span
      className={`rounded-full px-2 py-px text-[10px] font-semibold ${MODE_STYLE[mode.key]}`}
      title={mode.detail}
    >
      {mode.label}
    </span>
  );
  return (
    <>
      <div className="stagger contents">
        <Message speaker="ai" name="Sentinel AI" tag={tag} time={time}>
          {evidence.length ? (
            <>
              <p>
                I read {evidence.length} source{evidence.length === 1 ? "" : "s"} for this case:
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {evidence.map((l) => {
                  const r = String(l["ref"]);
                  return (
                    <li key={r}>
                      <button
                        type="button"
                        onClick={() => setOpenRef(r)}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                        {lookupLabel(r)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p>I wasn't given any records, so treat what follows as unsupported.</p>
          )}
        </Message>
        <Message speaker="ai" name="Sentinel AI" tag={tag}>
          <p>{plainSentence(out.summary)}</p>
          {!out.complete && (
            <p className="text-xs text-muted-foreground">
              I ran out of lookups before reading every source, so this is partial.
            </p>
          )}
        </Message>
        {(out.proposed_actions.length > 0 || out.open_questions.length > 0) && (
          <Message speaker="ai" name="Sentinel AI" tag={tag}>
            {out.proposed_actions.length > 0 && (
              <>
                <p>What I'd suggest a person does next:</p>
                <ul className="space-y-1">
                  {out.proposed_actions.map((a) => (
                    <li key={a} className="flex items-start gap-2 font-medium">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {plain(a)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {out.open_questions.length > 0 && (
              <>
                <p className="text-muted-foreground">Still unanswered:</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {out.open_questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              These are suggestions.{" "}
              {out.case_state_unchanged ? "Nothing on the case was changed." : ""}
            </p>
          </Message>
        )}
      </div>
      <li className="pl-12">
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            How this answer was produced
            <ChevronDown
              className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="collapsible-content">
            <p className="mt-2 text-[11px] text-muted-foreground">{mode.detail}</p>
            <ol className="mt-1 space-y-1 text-xs text-muted-foreground">
              {out.lookups.map((l, i) => (
                <li key={String(l["ref"])} className="flex flex-wrap gap-x-2">
                  <span className="figure w-5 text-right">{i + 1}.</span>
                  <code className="font-mono text-[11px] text-foreground">
                    {String(l["tool"] ?? l["ref"])}
                  </code>
                  <span>· {l["over_budget"] ? "over budget" : "completed"}</span>
                  <span>· {String(l["rows"])} rows</span>
                </li>
              ))}
            </ol>
            {out.rejected_reason && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Why this mode: {friendlyReason(out.rejected_reason)}
              </p>
            )}
            {out.model && (
              <p className="mt-1 text-[11px] text-muted-foreground">Model: {out.model}</p>
            )}
          </CollapsibleContent>
        </Collapsible>
      </li>
      <EvidenceDrawer
        open={!!open}
        onOpenChange={(v) => !v && setOpenRef(null)}
        eyebrow="Read-only lookup"
        title={open ? lookupLabel(String(open["ref"])) : ""}
        description="A lookup the investigation actually made. The full records are in the linked invoice and supplier pages."
        facts={
          open
            ? [
                ["Lookup", String(open["tool"] ?? open["ref"])],
                [
                  "For",
                  Object.entries((open["args"] as Record<string, unknown>) ?? {})
                    .map(([k, v]) => `${plain(k)} ${String(v)}`)
                    .join(", "),
                ],
                ["Records read", String(open["rows"])],
                ["Cited in answer", out.evidence.includes(String(open["ref"])) ? "Yes" : "No"],
                ["Result fingerprint", String(open["result_hash"] ?? "").slice(0, 16) || null],
              ]
            : []
        }
        link={
          open && (open["args"] as Record<string, unknown>)?.["vendor_id"]
            ? {
                to: "vendor",
                vendorId: String((open["args"] as Record<string, unknown>)["vendor_id"]),
              }
            : open && (open["args"] as Record<string, unknown>)?.["invoice_id"]
              ? {
                  to: "invoice",
                  invoiceId: String((open["args"] as Record<string, unknown>)["invoice_id"]),
                }
              : undefined
        }
      />
    </>
  );
}

export function friendlyReason(reason: string): string {
  if (reason.startsWith("AI_ENABLED=false")) return "AI investigation is turned off.";
  if (reason.includes("No ANTHROPIC_API_KEY"))
    return "AI isn't configured and there's no recorded answer for this case.";
  if (reason.toLowerCase().includes("budget") || reason.includes("cost cap"))
    return "The AI spending limit was reached.";
  if (reason.startsWith("Model output rejected"))
    return "The AI's answer included something not supported by the evidence, so it wasn't shown.";
  if (reason.includes("unreachable") || reason.includes("HTTP"))
    return "The AI service couldn't be reached.";
  return reason;
}
