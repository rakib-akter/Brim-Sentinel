import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Database,
  FileSearch,
  Lightbulb,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api } from "@/lib/api/client";
import type { InvestigationOut } from "@/lib/api/schema";
import { lookupLabel, plain } from "@/lib/plain-language";
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

const CANNOT = [
  "Verify bank details",
  "Approve the invoice",
  "Release or schedule a payment",
  "Lift or change the hold",
];

/** Slow-response threshold after which we say so plainly (no fake progress). */
const SLOW_MS = 12_000;

/**
 * Investigation activity for a case. The backend returns one completed result, so while it runs
 * the panel shows a neutral indeterminate state; the lookups appear only after the backend reports
 * them. Proposals are only proposals: the hold is never changed here.
 */
export function InvestigatePanel({ caseId, issue }: { caseId: string; issue?: string }) {
  const { user } = useSession();
  const cache = useQueryClient();
  const [slow, setSlow] = useState(false);
  const run = useMutation({
    mutationFn: () => api.investigate(user.id, caseId),
    retry: false,
    // New lookups are audit events, so refresh the payment journey and graph.
    onSuccess: () => cache.invalidateQueries({ queryKey: ["flight", user.id] }),
  });
  useEffect(() => {
    if (!run.isPending) return setSlow(false);
    const t = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(t);
  }, [run.isPending]);
  if (user.role === "requester") return null;
  const mode = run.data ? investigationMode(run.data) : null;
  const status = run.isPending
    ? "Investigating"
    : run.error
      ? "Couldn't finish"
      : run.data
        ? run.data.complete
          ? "Complete"
          : "Partial result"
        : "Not started";
  return (
    <section
      className="overflow-hidden rounded-xl border bg-gradient-to-b from-primary-soft/40 to-card"
      aria-labelledby={`inv-${caseId}`}
    >
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground ${
            run.isPending ? "active-dot" : ""
          }`}
        >
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h4 id={`inv-${caseId}`} className="text-sm font-semibold">
            Investigation activity
          </h4>
          <p className="truncate text-xs text-muted-foreground">
            {issue ? `${issue} · ` : ""}
            <span aria-live="polite">{status}</span>
          </p>
        </div>
        {mode && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${MODE_STYLE[mode.key]}`}
            title={mode.detail}
          >
            {mode.label}
          </span>
        )}
        <Button
          size="sm"
          variant={run.data ? "outline" : "default"}
          onClick={() => run.mutate()}
          disabled={run.isPending}
        >
          {run.data || run.error ? <RotateCcw aria-hidden /> : <FileSearch aria-hidden />}
          {run.isPending ? "Investigating…" : run.data || run.error ? "Run again" : "Investigate"}
        </Button>
      </header>

      {!run.data && !run.isPending && !run.error && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          Sentinel reads the case evidence with read-only lookups and explains what it finds. It
          cannot approve, verify, release or change the hold.
        </p>
      )}

      {run.isPending && (
        <div className="border-t px-4 py-3" role="status">
          <div className="processing-bar h-1 rounded-full bg-primary/15" aria-hidden />
          <p className="mt-2 text-xs text-muted-foreground">
            Sentinel is reading the permitted evidence. The lookups it made will be listed when it
            finishes.
            {slow && " This is taking longer than usual; you can keep working and come back."}
          </p>
        </div>
      )}

      {run.error && !run.isPending && (
        <div role="alert" className="border-t px-4 py-3 text-sm">
          <p className="font-medium text-critical-foreground">The investigation didn't finish.</p>
          <p className="text-xs text-muted-foreground">
            {errorMessage(run.error)} Nothing was changed on the case. Try again, or continue with
            the steps below.
          </p>
        </div>
      )}

      {run.data && !run.isPending && <Findings key={run.submittedAt} out={run.data} />}
    </section>
  );
}

function Findings({ out }: { out: InvestigationOut }) {
  const [openRef, setOpenRef] = useState<string | null>(null);
  const cited = out.lookups.filter((l) => out.evidence.includes(String(l["ref"])));
  const evidence = cited.length ? cited : out.lookups;
  const open = out.lookups.find((l) => String(l["ref"]) === openRef);
  const mode = investigationMode(out);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="fade-in space-y-4 border-t px-4 py-4 text-sm outline-none"
    >
      <section>
        <h5 className="eyebrow flex items-center gap-1.5">
          <Lightbulb className="size-3.5" aria-hidden /> What I found
        </h5>
        <p className="mt-1.5 leading-relaxed">{out.summary}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {mode.detail}
          {!out.complete && " Incomplete: the lookup budget ran out before every source was read."}
        </p>
      </section>

      <section>
        <h5 className="eyebrow flex items-center gap-1.5">
          <Database className="size-3.5" aria-hidden /> Evidence checked
        </h5>
        {evidence.length ? (
          <ul className="stagger mt-2 grid gap-2 sm:grid-cols-2">
            {evidence.map((l) => {
              const r = String(l["ref"]);
              return (
                <li key={r}>
                  <button
                    type="button"
                    onClick={() => setOpenRef(r)}
                    className="lift flex w-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left"
                  >
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{lookupLabel(r)}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {String(l["rows"])} {Number(l["rows"]) === 1 ? "record" : "records"}
                        {out.evidence.includes(r) ? " · cited" : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">
            No evidence was returned. Treat this explanation as unsupported.
          </p>
        )}
      </section>

      <section>
        <h5 className="eyebrow">Recommended next step</h5>
        {out.proposed_actions.length ? (
          <ul className="mt-1.5 space-y-1">
            {out.proposed_actions.map((a) => (
              <li key={a} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                {plain(a)}
                <span className="rounded-full bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                  proposal · a person decides
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">No step was proposed.</p>
        )}
        {out.open_questions.length > 0 && (
          <div className="mt-2">
            <p className="flex items-center gap-1 text-xs font-medium">
              <CircleHelp className="size-3.5" aria-hidden /> Open questions
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {out.open_questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg bg-secondary/60 px-3 py-2.5">
        <h5 className="eyebrow flex items-center gap-1.5">
          <Ban className="size-3.5" aria-hidden /> What Sentinel cannot do
        </h5>
        <p className="mt-1 text-xs text-muted-foreground">
          {CANNOT.join(" · ")}.{" "}
          {out.case_state_unchanged ? "The case was not changed by this run." : ""}
        </p>
      </section>

      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          Investigation details
          <ChevronDown
            className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="collapsible-content">
          <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
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
          <p className="mt-2 text-[11px] text-muted-foreground">{out.proposals_status}</p>
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
    </div>
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
