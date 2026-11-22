import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
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
import type { InvoiceDetail as InvoiceRecord } from "@/lib/api/schema";
import type { Finding } from "@/lib/domain/types";
import { plain } from "@/lib/plain-language";
import { useSession } from "@/lib/session";
import { downloadFile, WorkflowForm } from "./workflow-form";

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

/* ML coding lives in ./ml-coding (re-exported for existing imports). */
export { CodingPanel } from "./ml-coding";

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
