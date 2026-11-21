import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import type { InvestigationOut } from "@/lib/api/schema";
import { useSession } from "@/lib/session";
import { errorMessage, humanize } from "./workflow-form";

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
      {run.data && <Result out={run.data} />}
    </section>
  );
}

function Result({ out }: { out: InvestigationOut }) {
  const byModel = out.source === "model";
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        {byModel
          ? `Written by ${out.model ?? "the model"} and fact-checked against the lookups below.`
          : "Standard explanation built from the rule results (AI off, unavailable or its answer failed the fact check)."}
        {!out.complete && " Incomplete: the lookup budget ran out."}
      </p>
      <p className="leading-relaxed">{out.summary}</p>
      {out.proposed_actions.length > 0 && (
        <div>
          <p className="font-medium">Suggested next steps (proposals only)</p>
          <ul className="list-disc pl-5">
            {out.proposed_actions.map((a) => (
              <li key={a}>{humanize(a)}</li>
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
          {out.lookups.length} read-only lookups
          {out.ai_cost_usd != null && ` · AI cost USD ${out.ai_cost_usd.toFixed(4)}`}
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          {out.lookups.map((l) => (
            <li key={String(l["ref"])}>
              <span className={out.evidence.includes(String(l["ref"])) ? "font-medium text-foreground" : ""}>
                {String(l["ref"])}
              </span>{" "}
              · {String(l["rows"])} rows · {String(l["duration_ms"])} ms
            </li>
          ))}
        </ol>
        {out.rejected_reason && byModel === false && (
          <p className="mt-2 text-xs text-muted-foreground">Why the standard explanation: {out.rejected_reason}</p>
        )}
      </details>
    </div>
  );
}
