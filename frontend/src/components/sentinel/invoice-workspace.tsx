import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Brain,
  Check,
  CircleDot,
  FileText,
  Lock,
  Minus,
  PauseCircle,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import type { InvoiceDetail as InvoiceRecord, LineOut } from "@/lib/api/schema";
import type { Finding } from "@/lib/domain/types";
import { formatMoney } from "@/lib/format";
import { plain } from "@/lib/plain-language";
import { useSession } from "@/lib/session";
import { Choice, downloadFile, Field, value, WorkflowForm } from "./workflow-form";

/* ------------------------------------------------------------------ progress rail */

type StageState = "done" | "current" | "blocked" | "locked" | "skipped";

const EARLY = new Set(["RECEIVED", "DRAFT", "EXTRACTED", "CODED", "VALIDATED"]);
const SETTLING = new Set(["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "RELEASED"]);
const STOPPED = new Set(["REJECTED", "CANCELLED"]);

export function stages(record: InvoiceRecord) {
  const s = record.lifecycle_state;
  const hadCases = record.resolution_cases.length > 0;
  const detect: [StageState, string] = EARLY.has(s)
    ? ["current", "Reading and checking"]
    : ["done", "Read, coded and checked"];
  const resolve: [StageState, string] =
    s === "ON_HOLD"
      ? ["blocked", "Payment paused"]
      : STOPPED.has(s)
        ? ["skipped", plain(s)]
        : EARLY.has(s)
          ? ["locked", "After checks"]
          : hadCases
            ? ["done", "Issues resolved"]
            : ["done", "Nothing to resolve"];
  const settle: [StageState, string] =
    record.kind === "credit_note" || s === "CREDIT_RECORDED"
      ? ["skipped", "Credit note, never paid"]
      : s === "SETTLED"
        ? ["done", "Paid (simulated)"]
        : SETTLING.has(s) || s === "FAILED"
          ? ["current", plain(s)]
          : STOPPED.has(s)
            ? ["skipped", plain(s)]
            : ["locked", s === "ON_HOLD" ? "Waiting on Resolve" : "After checks"];
  return [
    { id: "detect", label: "Detect", state: detect[0], note: detect[1] },
    { id: "resolution", label: "Resolve", state: resolve[0], note: resolve[1] },
    { id: "settle", label: "Settle", state: settle[0], note: settle[1] },
    { id: "explain", label: "Explain", state: "done" as StageState, note: "Payment journey" },
  ];
}

const STAGE_STYLE: Record<StageState, { icon: typeof Check; ring: string; text: string }> = {
  done: { icon: Check, ring: "bg-success-soft text-success-foreground", text: "text-foreground" },
  current: { icon: CircleDot, ring: "bg-primary text-primary-foreground", text: "text-foreground" },
  blocked: {
    icon: PauseCircle,
    ring: "bg-critical-soft text-critical-foreground",
    text: "text-critical-foreground",
  },
  locked: { icon: Lock, ring: "bg-secondary text-muted-foreground", text: "text-muted-foreground" },
  skipped: {
    icon: Minus,
    ring: "bg-secondary text-muted-foreground",
    text: "text-muted-foreground",
  },
};

/** Detect → Resolve → Settle → Explain, derived from the backend lifecycle state. */
export function ProgressRail({ record }: { record: InvoiceRecord }) {
  const [inView, setInView] = useState<string | null>(null);
  useEffect(() => {
    // Highlight the stage whose section is on screen (scrollspy).
    const ids = ["detect", "resolution", "settle", "explain"];
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setInView(top.target.id);
      },
      { rootMargin: "-30% 0px -55% 0px" },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, []);
  return (
    <nav
      aria-label="Invoice progress"
      className="surface sticky top-2 z-20 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/90"
    >
      <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {stages(record).map((st, i) => {
          const style = STAGE_STYLE[st.state];
          return (
            <li key={st.id}>
              <a
                href={`#${st.id}`}
                aria-current={st.state === "current" || st.state === "blocked" ? "step" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-secondary/70 ${
                  inView === st.id ? "bg-primary-soft/60 ring-1 ring-primary/30" : ""
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full ${style.ring}`}
                >
                  <style.icon className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${style.text}`}>
                    {i + 1}. {st.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{st.note}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------ sentinel analysis */

/** The one thing to know about this invoice, its next step, and what Sentinel checked. */
export function SentinelAnalysis({
  record,
  findings,
  plainStatus,
  actionLabel,
  actionTarget,
}: {
  record: InvoiceRecord;
  findings: Finding[];
  plainStatus: string;
  actionLabel: string;
  actionTarget: string | null;
}) {
  const hold = findings.find((f) => f.blocking);
  const advisory = findings.find((f) => !f.blocking);
  const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 } as Record<string, number>;
  for (const f of record.validation_findings) counts[f.result] = (counts[f.result] ?? 0) + 1;
  const needsPerson = record.line_items.filter((l) => l.coding_status === "NEEDS_REVIEW").length;
  const openCases = record.resolution_cases.filter(
    (c) => !["RESOLVED", "REJECTED", "CANCELLED"].includes(c.state),
  ).length;
  const tone = hold ? "border-l-critical" : advisory ? "border-l-warning" : "border-l-success";
  return (
    <section id="detect" className={`surface rise-in scroll-mt-4 border-l-4 ${tone} px-5 py-4`}>
      <p className="eyebrow">Sentinel analysis</p>
      <div className="mt-1 flex flex-wrap items-start gap-3">
        {hold ? (
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-critical" aria-hidden />
        ) : (
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug tracking-tight">
            {hold ? hold.title : plainStatus}
          </h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {hold ? (
              <span className="rounded-full bg-critical-soft px-2 py-px text-[11px] font-medium text-critical-foreground">
                Hard hold — payment paused until resolved
              </span>
            ) : null}
            {advisory ? (
              <span className="rounded-full bg-warning-soft px-2 py-px text-[11px] font-medium text-warning-foreground">
                Advisory — worth a look, doesn't block payment
              </span>
            ) : null}
          </div>
          {(hold ?? advisory) && (
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="eyebrow">Why this matters</dt>
                <dd className="mt-1 text-sm">{(hold ?? advisory)!.whyItMatters}</dd>
              </div>
              <div>
                <dt className="eyebrow">What happens next</dt>
                <dd className="mt-1 text-sm">{(hold ?? advisory)!.whatHappensNext}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {actionTarget && (
          <Button asChild>
            <a href={`#${actionTarget}`}>
              {actionLabel}
              <ArrowRight aria-hidden />
            </a>
          </Button>
        )}
        {openCases > 0 && (
          <Button variant="outline" asChild>
            <a href="#resolution">
              <Sparkles aria-hidden /> Ask Sentinel why
            </a>
          </Button>
        )}
      </div>
      <ul className="mt-4 grid gap-2 border-t pt-3 text-xs text-muted-foreground sm:grid-cols-3">
        <li>
          <span className="font-medium text-foreground">Extraction</span> ·{" "}
          {plain(record.provenance) || "unknown source"}
          {record.uncertain_fields.length > 0 && (
            <span className="text-warning-foreground">
              {" "}
              · {record.uncertain_fields.length} field
              {record.uncertain_fields.length === 1 ? "" : "s"} need a person
            </span>
          )}
        </li>
        <li>
          <span className="font-medium text-foreground">Coding</span> · {record.line_items.length}{" "}
          line{record.line_items.length === 1 ? "" : "s"}
          {needsPerson > 0 ? (
            <span className="text-warning-foreground"> · {needsPerson} need a person</span>
          ) : (
            " · suggested"
          )}
        </li>
        <li>
          <span className="font-medium text-foreground">Checks</span> · {counts["PASS"] ?? 0} passed
          {(counts["FAIL"] ?? 0) > 0 && (
            <span className="text-critical-foreground"> · {counts["FAIL"]} problems</span>
          )}
          {(counts["UNKNOWN"] ?? 0) > 0 && (
            <span className="text-warning-foreground">
              {" "}
              · {counts["UNKNOWN"]} couldn't be confirmed
            </span>
          )}
        </li>
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ ML coding */

const CODING_STATUS: Record<string, { label: string; cls: string }> = {
  SUGGESTED: { label: "Suggested", cls: "bg-primary-soft text-primary" },
  NEEDS_REVIEW: { label: "Needs a person", cls: "bg-warning-soft text-warning-foreground" },
  CONFIRMED: { label: "Confirmed by a person", cls: "bg-success-soft text-success-foreground" },
  OVERRIDDEN: { label: "Changed by a person", cls: "bg-success-soft text-success-foreground" },
};

const pct = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round((n <= 1 ? n * 100 : n) as number) : null;
};

/** GL coding suggestions with confidence, alternatives and the past lines behind them. */
export function CodingPanel({ record }: { record: InvoiceRecord }) {
  const { user } = useSession();
  const canDecide = record.allowed_actions.includes("coding_decision");
  const pending = record.line_items.filter(
    (l) => l.gl_account && !["CONFIRMED", "OVERRIDDEN"].includes(l.coding_status ?? ""),
  );
  return (
    <section className="surface px-5 py-4" aria-labelledby="coding-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="coding-heading" className="flex items-center gap-2 text-sm font-semibold">
            <Brain className="size-4 text-primary" aria-hidden /> Accounting codes
          </h2>
          <p className="text-xs text-muted-foreground">
            Suggested by a model trained on Harborline's past invoices. Below 70% confidence, or for
            a new supplier, a person must decide.
          </p>
        </div>
        {canDecide && pending.length > 1 && (
          <WorkflowForm
            label={`Accept all ${pending.length} suggestions`}
            success="Suggestions accepted."
            run={() =>
              api.coding(user.id, record.id, {
                expected_version: record.version,
                lines: pending.map((l) => ({ line_no: l.line_no, gl_account: l.gl_account })),
              })
            }
          />
        )}
      </div>
      {record.line_items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No line items were read.</p>
      ) : (
        <ol className="stagger mt-3 space-y-3">
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
  const confidence = pct(line.coding_confidence);
  const status = CODING_STATUS[line.coding_status ?? ""];
  const decided = ["CONFIRMED", "OVERRIDDEN"].includes(line.coding_status ?? "");
  const alternatives = line.alternatives
    .map((a) => ({
      gl: String(a["gl_account"] ?? ""),
      name: a["gl_name"] ? String(a["gl_name"]) : "",
      weight: pct(a["weight"]),
    }))
    .filter((a) => a.gl);
  return (
    <li className="rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span className="text-muted-foreground">Line {line.line_no} · </span>
          {line.description}
        </p>
        {line.amount_minor !== null && (
          <span className="figure text-sm">{formatMoney(line.amount_minor, currency)}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium">
          {line.gl_account ? (
            <>
              <span className="figure">{line.gl_account}</span>
              {line.gl_name ? <span className="font-normal"> · {line.gl_name}</span> : null}
            </>
          ) : (
            <span className="text-warning-foreground">No account suggested</span>
          )}
        </p>
        {status && (
          <span className={`rounded-full px-2 py-px text-[11px] font-medium ${status.cls}`}>
            {status.label}
          </span>
        )}
      </div>
      {confidence !== null && (
        <div
          className="mt-2 flex items-center gap-2"
          aria-label={`Model confidence ${confidence}%`}
        >
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full ${confidence >= 70 ? "bg-primary" : "bg-warning"}`}
              style={{ width: `${Math.max(2, Math.min(100, confidence))}%` }}
            />
          </div>
          <span className="figure text-xs text-muted-foreground">{confidence}% confidence</span>
        </div>
      )}
      {alternatives.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Other likely accounts:{" "}
          {alternatives
            .map(
              (a) =>
                `${a.gl}${a.name ? ` ${a.name}` : ""}${a.weight !== null ? ` (${a.weight}%)` : ""}`,
            )
            .join(" · ")}
        </p>
      )}
      {line.similar_lines.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Why: {line.similar_lines.length} similar past line
            {line.similar_lines.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {line.similar_lines.slice(0, 3).map((s, i) => {
              const invoiceId = String(s["invoice_id"] ?? "");
              const sim = pct(s["similarity"]);
              return (
                <li key={`${invoiceId}-${i}`} className="text-muted-foreground">
                  {invoiceId ? (
                    <Link
                      className="text-primary hover:underline"
                      to="/invoices/$invoiceId"
                      params={{ invoiceId }}
                    >
                      {invoiceId}
                    </Link>
                  ) : null}{" "}
                  “{String(s["description"] ?? "")}” → {String(s["gl_account"] ?? "")}
                  {sim !== null ? ` · ${sim}% similar` : ""}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {canDecide && !decided && line.gl_account && (
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <WorkflowForm
            label="Accept suggestion"
            success="Accepted."
            run={() =>
              api.coding(user.id, record.id, {
                expected_version: record.version,
                lines: [{ line_no: line.line_no, gl_account: line.gl_account }],
              })
            }
          />
          {alternatives.length > 0 && (
            <details className="min-w-[16rem] flex-1 text-sm">
              <summary className="cursor-pointer py-1 text-primary">Choose another account</summary>
              <WorkflowForm
                label="Use this account"
                success="Changed. The reason is in the audit log."
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
    </li>
  );
}

/* ------------------------------------------------------------------ document */

/** The original invoice, always visible beside the analysis. */
export function DocumentPanel({
  invoiceId,
  fileName,
  scanned,
}: {
  invoiceId: string;
  fileName: string | null;
  scanned: boolean;
}) {
  const { user } = useSession();
  return (
    <section className="surface flex flex-col gap-3 px-4 py-3" aria-labelledby="document-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="document-heading" className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4" aria-hidden /> Original document
        </h2>
        {fileName && (
          <WorkflowForm
            label="Download original"
            refresh={false}
            success=""
            run={async () => {
              downloadFile(await api.document(user.id, invoiceId), fileName);
            }}
          />
        )}
      </div>
      {fileName ? (
        <>
          <p className="break-all text-xs text-muted-foreground">{fileName}</p>
          <OriginalPreview actor={user.id} invoiceId={invoiceId} scanned={scanned} />
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No document is attached to this record.
        </p>
      )}
    </section>
  );
}

function OriginalPreview({
  actor,
  invoiceId,
  scanned,
}: {
  actor: string;
  invoiceId: string;
  scanned: boolean;
}) {
  const preview = useQuery({
    queryKey: ["invoice-document", actor, invoiceId],
    queryFn: () => api.document(actor, invoiceId),
  });
  const attachSource = useCallback(
    (element: HTMLImageElement | HTMLIFrameElement | null) => {
      if (!element || !preview.data) return;
      const url = URL.createObjectURL(preview.data);
      element.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [preview.data],
  );
  if (preview.error)
    return (
      <p role="alert" className="text-sm">
        {preview.error.message}
      </p>
    );
  if (!preview.data)
    return (
      <p role="status" className="py-10 text-center text-sm text-muted-foreground">
        Loading the original…
      </p>
    );
  return scanned ? (
    <img
      ref={attachSource}
      alt="Original invoice scan"
      className="max-h-[78vh] w-full rounded-md border object-contain"
    />
  ) : (
    <iframe
      ref={attachSource}
      title="Original invoice PDF"
      className="h-[78vh] w-full rounded-md border"
    />
  );
}
