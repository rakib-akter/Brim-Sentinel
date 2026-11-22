import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import type { InvestigationOut } from "@/lib/api/schema";
import { useSession } from "@/lib/session";
import { lookupLabel, plain } from "@/lib/plain-language";
import { errorMessage } from "./workflow-form";

/**
 * Runs the bounded, read-only investigation for a case and shows its cited summary.
 * The output is advisory: proposals are only proposals, and the hold is never changed here.
 */
export function InvestigatePanel({ caseId }: { caseId: string }) {
  const { user } = useSession();
  const cache = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.investigate(user.id, caseId),
    retry: false,
    // New lookups are audit events, so refresh the payment journey.
    onSuccess: () => cache.invalidateQueries({ queryKey: ["flight", user.id] }),
  });
  if (user.role === "requester") return null;
  return (
    <section className="rounded-md border bg-muted/30 px-4 py-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-1.5 font-medium">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Investigate with Sentinel AI
          </h4>
          <p className="text-muted-foreground">
            Reads the evidence with read-only lookups and explains it. It cannot approve, verify,
            release or change the hold.
          </p>
        </div>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? "Investigating…" : run.data ? "Run again" : "Investigate"}
        </Button>
      </div>
      {run.error && (
        <p role="alert" className="mt-2 text-critical-foreground">
          {errorMessage(run.error)}
        </p>
      )}
      {run.isPending && <Thinking />}
      {run.data && !run.isPending && <Steps key={run.submittedAt} out={run.data} />}
    </section>
  );
}

const THINKING = [
  "Reading the invoice and its check results",
  "Looking up the supplier, bank changes and related records",
  "Checking every figure against the evidence",
];

/** Shown while the request runs. Generic on purpose: the real steps appear once it finishes. */
function Thinking() {
  return (
    <ul className="fade-in mt-3 space-y-1.5" role="status" aria-label="Sentinel is investigating">
      {THINKING.map((t, i) => (
        <li key={t} className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
          <span className="thinking" style={{ animationDelay: `${i * 200}ms` }}>
            {t}…
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The lookups Sentinel actually made appear one by one, then the cited answer. */
function Steps({ out }: { out: InvestigationOut }) {
  const total = out.lookups.length;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(total);
      return;
    }
    if (shown >= total) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), 280);
    return () => window.clearTimeout(t);
  }, [shown, total]);
  return (
    <div className="mt-3 space-y-3">
      <ol className="space-y-1" aria-label="Steps Sentinel took">
        {out.lookups.slice(0, shown).map((l) => (
          <li key={String(l["ref"])} className="rise-in flex items-center gap-2 text-xs">
            <Check className="size-3.5 text-success" aria-hidden />
            <span>{lookupLabel(String(l["ref"]))}</span>
            <span className="text-muted-foreground">
              · {String(l["rows"])} {Number(l["rows"]) === 1 ? "record" : "records"}
            </span>
          </li>
        ))}
      </ol>
      {shown >= total && (
        <div className="fade-in">
          <Result out={out} />
        </div>
      )}
    </div>
  );
}

function Result({ out }: { out: InvestigationOut }) {
  const byModel = out.source === "model";
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        {byModel
          ? out.replayed
            ? `Replayed from a recorded run of ${out.model ?? "the AI model"}, fact-checked against the evidence below.`
            : `Live answer from ${out.model ?? "the AI model"}, fact-checked against the evidence below.`
          : "Standard explanation built from the rule results (AI is off or unavailable, or its answer didn't pass the fact check)."}
        {!out.complete && " Incomplete: the lookup budget ran out."}
      </p>
      <p className="leading-relaxed">{out.summary}</p>
      {out.proposed_actions.length > 0 && (
        <div>
          <p className="font-medium">Suggested next steps (proposals only)</p>
          <ul className="list-disc pl-5">
            {out.proposed_actions.map((a) => (
              <li key={a}>{plain(a)}</li>
            ))}
          </ul>
        </div>
      )}
      {out.open_questions.length > 0 && (
        <div>
          <p className="font-medium">Open questions</p>
          <ul className="list-disc pl-5">
            {out.open_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-muted-foreground">
          What Sentinel checked ({out.lookups.length} read-only lookups)
          {out.ai_cost_usd != null &&
            (out.replayed
              ? " · no AI cost (replayed)"
              : ` · AI cost USD ${out.ai_cost_usd.toFixed(4)}`)}
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          {out.lookups.map((l) => (
            <li key={String(l["ref"])}>
              <span
                className={
                  out.evidence.includes(String(l["ref"])) ? "font-medium text-foreground" : ""
                }
              >
                {lookupLabel(String(l["ref"]))}
              </span>{" "}
              · {String(l["rows"])} {Number(l["rows"]) === 1 ? "record" : "records"}
              {out.evidence.includes(String(l["ref"])) && " · cited"}
            </li>
          ))}
        </ol>
        {out.rejected_reason && byModel === false && (
          <p className="mt-2 text-xs text-muted-foreground">
            Why the standard explanation: {friendlyReason(out.rejected_reason)}
          </p>
        )}
      </details>
    </div>
  );
}

function friendlyReason(reason: string): string {
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
