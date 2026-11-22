import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Brain,
  ChevronDown,
  CircleHelp,
  Gauge,
  History,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/lib/api/client";
import type { AnomalyOut, InvoiceDetail as InvoiceRecord, LineOut } from "@/lib/api/schema";
import { formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Choice, Field, value, WorkflowForm } from "./workflow-form";

/** Backend review gate (REVIEW_THRESHOLD in backend/app/services/coding.py). */
export const REVIEW_THRESHOLD_PCT = 70;

/** Where a coding suggestion came from, from the line's `coding_method` and `coding_status`. */
export function codingSource(line: Pick<LineOut, "coding_method" | "coding_status">): {
  kind: "model" | "fallback" | "human" | "unknown";
  label: string;
  detail: string;
} {
  if (line.coding_status === "CONFIRMED")
    return {
      kind: "human",
      label: "Confirmed by a person",
      detail: "A person accepted the ML suggestion.",
    };
  if (line.coding_status === "OVERRIDDEN")
    return {
      kind: "human",
      label: "Changed by a person",
      detail: "A person chose a different account. The reason is in the audit trail.",
    };
  const m = line.coding_method ?? "";
  if (/logreg|tfidf/i.test(m))
    return {
      kind: "model",
      label: "ML model",
      detail: `TF-IDF + logistic regression trained on Harborline's past invoice lines (${m}).`,
    };
  if (/knn|rapidfuzz/i.test(m))
    return {
      kind: "fallback",
      label: "Rule-based fallback",
      detail: `Nearest matching past lines by fuzzy text match (${m}). Used when the model can't be applied.`,
    };
  return {
    kind: "unknown",
    label: "Source unavailable",
    detail: "The backend did not say how this suggestion was made.",
  };
}

export const toPct = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n <= 1 ? n * 100 : n) : null;
};

const SOURCE_STYLE = {
  model: "bg-primary-soft text-primary",
  fallback: "bg-info-soft text-info-foreground",
  human: "bg-success-soft text-success-foreground",
  unknown: "bg-secondary text-muted-foreground",
} as const;

/** "ML suggested this GL account": prediction, confidence, alternatives, evidence, correction. */
export function CodingPanel({ record }: { record: InvoiceRecord }) {
  const { user } = useSession();
  const canDecide = record.allowed_actions.includes("coding_decision");
  const pending = record.line_items.filter(
    (l) => l.gl_account && !["CONFIRMED", "OVERRIDDEN"].includes(l.coding_status ?? ""),
  );
  const review = record.line_items.filter((l) => l.coding_status === "NEEDS_REVIEW").length;
  return (
    <section id="ml" className="surface scroll-mt-24 px-5 py-4" aria-labelledby="coding-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5">
            <Brain className="size-3.5 text-primary" aria-hidden /> Machine learning
          </p>
          <h2 id="coding-heading" className="mt-0.5 text-[15px] font-semibold tracking-tight">
            ML suggested {record.line_items.length === 1 ? "this GL account" : "these GL accounts"}
          </h2>
          <p className="text-xs text-muted-foreground">
            A suggestion, not a decision. Below {REVIEW_THRESHOLD_PCT}% confidence a person must
            choose
            {review
              ? ` — ${review} line${review === 1 ? "" : "s"} need${review === 1 ? "s" : ""} you`
              : ""}
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HowSentinelUsesML />
          {canDecide && pending.length > 1 && (
            <WorkflowForm
              label={`Accept all ${pending.length}`}
              success="Suggestions accepted and recorded."
              run={() =>
                api.coding(user.id, record.id, {
                  expected_version: record.version,
                  lines: pending.map((l) => ({ line_no: l.line_no, gl_account: l.gl_account })),
                })
              }
            />
          )}
        </div>
      </div>
      {record.line_items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No line items were read, so nothing was coded.
        </p>
      ) : (
        <ol className="stagger mt-3 space-y-2.5">
          {record.line_items.map((line) => (
            <CodingLine
              key={line.line_no}
              line={line}
              record={record}
              currency={record.currency ?? "CAD"}
              canDecide={canDecide}
            />
          ))}
        </ol>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden />
        ML codes the lines · deterministic checks decide holds · authorized people approve.
      </p>
    </section>
  );
}

function CodingLine({
  line,
  record,
  currency,
  canDecide,
}: {
  line: LineOut;
  record: InvoiceRecord;
  currency: string;
  canDecide: boolean;
}) {
  const { user } = useSession();
  const [more, setMore] = useState(false);
  const confidence = toPct(line.coding_confidence);
  const source = codingSource(line);
  const decided = source.kind === "human";
  const low =
    line.coding_status === "NEEDS_REVIEW" ||
    (confidence !== null && confidence < REVIEW_THRESHOLD_PCT);
  const alternatives = line.alternatives
    .map((a) => ({
      gl: String(a["gl_account"] ?? ""),
      name: a["gl_name"] ? String(a["gl_name"]) : "",
      weight: toPct(a["weight"]),
    }))
    .filter((a) => a.gl && a.gl !== line.gl_account)
    .slice(0, 3);
  return (
    <li
      className={`rounded-xl border px-4 py-3 ${low && !decided ? "border-warning/50 bg-warning-soft/30" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 text-xs text-muted-foreground">
          Line {line.line_no} · <span className="text-foreground">{line.description}</span>
        </p>
        {line.amount_minor !== null && (
          <span className="figure text-xs text-muted-foreground">
            {formatMoney(line.amount_minor, currency)}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 text-[15px] font-semibold">
          {line.gl_account ? (
            <>
              <span className="figure">{line.gl_account}</span>
              {line.gl_name ? <span className="font-normal"> · {line.gl_name}</span> : null}
            </>
          ) : (
            <span className="text-warning-foreground">No account suggested</span>
          )}
        </p>
        <span
          className={`rounded-full px-2 py-px text-[11px] font-medium ${SOURCE_STYLE[source.kind]}`}
          title={source.detail}
        >
          {source.label}
        </span>
        {confidence !== null && !decided && <ConfidenceMeter value={confidence} />}
      </div>

      {low && !decided && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-foreground">
          <CircleHelp className="mt-px size-3.5 shrink-0" aria-hidden />
          Low confidence: a person must choose the account. New suppliers are always sent for
          review.
        </p>
      )}

      {low || decided ? null : (
        <Collapsible open={more} onOpenChange={setMore} className="mt-1.5">
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {more ? "Hide details" : "Alternatives and why"}
            <ChevronDown
              className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
        </Collapsible>
      )}

      {alternatives.length > 0 && !decided && (low || more) && (
        <div className="mt-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">Next most likely</p>
          <ul className="mt-1 space-y-1">
            {alternatives.map((a) => (
              <li
                key={a.gl}
                className="grid grid-cols-[minmax(0,1fr)_4rem_2.5rem] items-center gap-2 text-xs"
              >
                <span className="truncate">
                  <span className="figure">{a.gl}</span>
                  {a.name ? <span className="text-muted-foreground"> · {a.name}</span> : null}
                </span>
                <span className="h-1 overflow-hidden rounded-full bg-secondary">
                  <span
                    className="block h-full rounded-full bg-muted-foreground/50"
                    style={{ width: `${Math.max(2, a.weight ?? 0)}%` }}
                  />
                </span>
                <span className="figure text-right text-muted-foreground">
                  {a.weight === null ? "—" : a.weight < 1 ? "<1%" : `${a.weight}%`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(low || more || decided) && (
        <WhyThisSuggestion line={line} record={record} source={source} />
      )}

      {canDecide && !decided && line.gl_account && (
        <div className="mt-2.5 flex flex-wrap items-start gap-3 border-t pt-2.5">
          <WorkflowForm
            label="Accept"
            success="Accepted and recorded in the audit trail."
            run={() =>
              api.coding(user.id, record.id, {
                expected_version: record.version,
                lines: [{ line_no: line.line_no, gl_account: line.gl_account }],
              })
            }
          />
          {alternatives.length > 0 && (
            <details className="min-w-[16rem] flex-1 text-sm">
              <summary className="cursor-pointer py-1.5 font-medium text-primary">
                Change account
              </summary>
              <WorkflowForm
                label="Use this account"
                success="Changed. Your reason is in the audit trail."
                run={(fields) =>
                  api.coding(user.id, record.id, {
                    expected_version: record.version,
                    lines: [
                      {
                        line_no: line.line_no,
                        gl_account: value(fields, "account"),
                        reason: value(fields, "reason"),
                      },
                    ],
                  })
                }
              >
                <Choice
                  label="Account"
                  name="account"
                  options={alternatives.map((a) => ({
                    value: a.gl,
                    label: `${a.gl}${a.name ? ` · ${a.name}` : ""}`,
                  }))}
                />
                <Field label="Why the suggestion is wrong" name="reason" />
              </WorkflowForm>
            </details>
          )}
        </div>
      )}
      {!canDecide && !decided && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Your role can't change coding on this invoice.
        </p>
      )}
    </li>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const ok = value >= REVIEW_THRESHOLD_PCT;
  return (
    <span className="flex items-center gap-2" aria-label={`Model confidence ${value}%`}>
      <span className="relative h-1.5 w-28 overflow-hidden rounded-full bg-secondary">
        <span
          className={`meter-fill block h-full rounded-full ${ok ? "bg-primary" : "bg-warning"}`}
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
        <span
          className="absolute inset-y-0 w-px bg-foreground/40"
          style={{ left: `${REVIEW_THRESHOLD_PCT}%` }}
          aria-hidden
        />
      </span>
      <span className="figure text-xs text-muted-foreground">{value}% confidence</span>
    </span>
  );
}

function WhyThisSuggestion({
  line,
  record,
  source,
}: {
  line: LineOut;
  record: InvoiceRecord;
  source: ReturnType<typeof codingSource>;
}) {
  const examples = line.similar_lines.slice(0, 3);
  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        Why this suggestion?
        <ChevronDown
          className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="collapsible-content">
        <div className="mt-2 space-y-2 rounded-lg bg-secondary/50 px-3 py-2.5 text-xs">
          <p>
            <span className="font-medium">Source:</span> {source.detail}
          </p>
          <p>
            <span className="font-medium">What it looked at:</span> the line text “
            {line.description}”{record.vendor_name ? `, the supplier (${record.vendor_name})` : ""}{" "}
            and how past lines like it were coded.
          </p>
          {examples.length > 0 ? (
            <div>
              <p className="flex items-center gap-1 font-medium">
                <History className="size-3.5" aria-hidden /> Similar past lines
              </p>
              <ul className="mt-1 space-y-1">
                {examples.map((s, i) => {
                  const invoiceId = String(s["invoice_id"] ?? "");
                  const sim = toPct(s["similarity"]);
                  return (
                    <li
                      key={`${invoiceId}-${i}`}
                      className="flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground"
                    >
                      {invoiceId ? (
                        <Link
                          className="text-primary hover:underline"
                          to="/invoices/$invoiceId"
                          params={{ invoiceId }}
                        >
                          {invoiceId}
                        </Link>
                      ) : null}
                      <span>“{String(s["description"] ?? "")}”</span>
                      <ArrowRight className="size-3 self-center" aria-hidden />
                      <span className="figure text-foreground">
                        {String(s["gl_account"] ?? "")}
                      </span>
                      {sim !== null && <span>· {sim}% text match</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">
              No similar past lines were returned for this line.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Sentinel shows the examples it used; it does not show per-feature weights.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const ML_STEPS: Array<{ icon: typeof Brain; title: string; body: string }> = [
  {
    icon: History,
    title: "Historical invoice lines",
    body: "Harborline's past coded lines (synthetic dataset).",
  },
  {
    icon: Brain,
    title: "Model prediction",
    body: "TF-IDF text features + supplier → logistic regression.",
  },
  {
    icon: Gauge,
    title: "Confidence & alternatives",
    body: `Top account, its probability and the runners-up. Under ${REVIEW_THRESHOLD_PCT}% → review.`,
  },
  {
    icon: UserCheck,
    title: "Human confirmation",
    body: "A person accepts or changes the account, with a reason.",
  },
  {
    icon: ShieldCheck,
    title: "Audit record",
    body: "Every decision is written to the tamper-evident audit trail.",
  },
];

/** Small explainer of where ML is used and where it is not. */
export function HowSentinelUsesML() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs">
          <CircleHelp aria-hidden /> How Sentinel uses ML
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>How Sentinel uses machine learning</DialogTitle>
          <DialogDescription>
            ML suggests accounting codes and ranks review priority. It never approves, holds or
            pays.
          </DialogDescription>
        </DialogHeader>
        <ol className="stagger grid gap-2 sm:grid-cols-5" aria-label="ML pipeline">
          {ML_STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-xl border bg-card px-3 py-2.5">
              <s.icon className="size-4 text-primary" aria-hidden />
              <p className="mt-1.5 text-xs font-semibold leading-tight">{s.title}</p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{s.body}</p>
              {i < ML_STEPS.length - 1 && (
                <ArrowRight
                  className="absolute -right-2.5 top-1/2 z-10 hidden size-4 -translate-y-1/2 rounded-full bg-background text-muted-foreground sm:block"
                  aria-hidden
                />
              )}
            </li>
          ))}
        </ol>
        <div className="grid gap-3 text-xs sm:grid-cols-3">
          <div className="rounded-lg bg-primary-soft/50 p-3">
            <p className="font-semibold text-primary">ML prediction</p>
            <p className="mt-1 text-muted-foreground">
              GL coding suggestions; review-priority score from unusual amounts and identity
              signals.
            </p>
          </div>
          <div className="rounded-lg bg-secondary p-3">
            <p className="font-semibold">Deterministic rules</p>
            <p className="mt-1 text-muted-foreground">
              Holds, duplicates, contract and bank-detail checks, approval routing. ML can't
              override them.
            </p>
          </div>
          <div className="rounded-lg bg-success-soft/60 p-3">
            <p className="font-semibold text-success-foreground">Human authorization</p>
            <p className="mt-1 text-muted-foreground">
              Coding confirmation, verification, approvals and the simulated release.
            </p>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The confidence shown is the model's own probability for its top account; it is not
          separately calibrated, so the {REVIEW_THRESHOLD_PCT}% review gate is what matters.
          Training and evaluation use a synthetic dataset (see
          backend/docs/MODELS_AND_EVALUATION.md); no figure here is a real-world accuracy claim. If
          the model can't load, a rule-based fuzzy match supplies the suggestion and is labelled as
          such.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Anomaly review priority: score, the actual contributing signals, and what it is not. */
export function AnomalyPanel({ anomaly }: { anomaly: AnomalyOut | null }) {
  if (!anomaly) return null;
  const score = toPct(anomaly.score);
  const band = anomaly.band?.toLowerCase();
  const tone =
    band === "high"
      ? "text-critical-foreground bg-critical-soft"
      : band === "medium"
        ? "text-warning-foreground bg-warning-soft"
        : "text-muted-foreground bg-secondary";
  const limited = anomaly.status === "INSUFFICIENT_HISTORY";
  return (
    <section className="surface px-5 py-4" aria-labelledby="anomaly-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-1.5">
            <Gauge className="size-3.5 text-primary" aria-hidden /> Review priority
          </p>
          <h2 id="anomaly-heading" className="mt-0.5 text-[15px] font-semibold">
            Risk signal, not a fraud probability
          </h2>
          <p className="text-xs text-muted-foreground">
            Ranks what to look at first. It never creates or clears a payment hold.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
          {band ? band.charAt(0).toUpperCase() + band.slice(1) : "Unscored"}
          {score !== null && !limited ? ` · ${score}/100` : ""}
        </span>
      </div>
      {limited && (
        <p className="mt-2 text-xs text-muted-foreground">
          Limited supplier history ({String(anomaly.inputs["history_count"] ?? "unknown")} prior
          invoices), so the score is not reliable.
        </p>
      )}
      {anomaly.signals.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {anomaly.signals.map((s, i) => {
            const strength = toPct(s["strength"]);
            return (
              <li key={i} className="flex gap-3 rounded-lg border px-3 py-2 text-sm">
                <span className="figure w-10 shrink-0 text-xs text-muted-foreground">
                  {strength !== null ? `${strength}` : "—"}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-muted-foreground">
                    {String(s["signal"] ?? s["group"] ?? "Signal").replaceAll("_", " ")}
                  </span>
                  {String(s["explanation"] ?? "")}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No contributing signals were returned.</p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Method: {anomaly.method_version} · as of {anomaly.as_of}
      </p>
    </section>
  );
}
