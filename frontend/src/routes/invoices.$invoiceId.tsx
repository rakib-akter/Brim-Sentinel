import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  FileSearch,
  ListChecks,
  Network,
  ScanSearch,
  Share2,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleHelp,
  Lock,
  MinusCircle,
  PauseCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/sentinel/empty-state";
import {
  LanguageBadge,
  RiskIndicator,
  SimulatedTag,
  StatusBadge,
} from "@/components/sentinel/badges";
import { Money } from "@/components/sentinel/money";
import { api } from "@/lib/api/client";
import { ResolutionCase } from "@/components/sentinel/resolution-case";
import { ApprovalDecision, InvoiceCorrections } from "@/components/sentinel/invoice-actions";
import { Evidence, FlightRecorder } from "@/components/sentinel/flight-recorder";
import { SentinelAnalysis, stages } from "@/components/sentinel/invoice-workspace";
import { AnomalyPanel, CodingPanel } from "@/components/sentinel/ml-coding";
import { DocumentPane, useDocumentLayout } from "@/components/sentinel/document-pane";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { anchorKeyForRefs, DocumentFocusContext, useDocumentFocus } from "@/lib/document-focus";

const DecisionGraph = lazy(() =>
  import("@/components/sentinel/decision-graph").then((m) => ({ default: m.DecisionGraph })),
);
const ConnectionsGraph = lazy(() =>
  import("@/components/sentinel/connections-graph").then((m) => ({ default: m.ConnectionsGraph })),
);
import { PaymentWorkflow } from "@/components/sentinel/payment-workflow";
import { SourceReview } from "@/components/sentinel/source-review";
import { Field, humanize, value, WorkflowForm } from "@/components/sentinel/workflow-form";
import type { InvoiceDetail as InvoiceView } from "@/lib/domain/types";
import type { InvoiceDetail as InvoiceRecord } from "@/lib/api/schema";
import { invoiceQuery } from "@/lib/api/queries";
import { ROLES } from "@/lib/domain/roles";
import type { CheckResult, Finding } from "@/lib/domain/types";
import { dueLabel, formatDate, formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";

type InvoiceDetail = InvoiceView & { record: InvoiceRecord };

export const Route = createFileRoute("/invoices/$invoiceId")({
  head: ({ params }) => ({
    meta: [
      { title: `Invoice ${params.invoiceId} — Brim Sentinel` },
      {
        name: "description",
        content:
          "Invoice review: source document, extracted details, checks and the next safe step.",
      },
      { property: "og:title", content: `Invoice ${params.invoiceId} — Brim Sentinel` },
      {
        property: "og:description",
        content: "Plain-language invoice review with evidence-backed checks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(invoiceQuery(context.actor, params.invoiceId));
  },
  component: InvoicePage,
});

function InvoicePage() {
  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" asChild>
        <Link to="/invoices">
          <ArrowLeft aria-hidden /> Invoice Inbox
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-[600px] rounded-xl" />}>
        <InvoiceContent />
      </Suspense>
    </div>
  );
}

type View = "review" | "source" | "graph" | "connections";
const VIEWS: Array<{ id: View; label: string; icon: typeof FileSearch }> = [
  { id: "review", label: "Review", icon: ListChecks },
  { id: "source", label: "Source document", icon: FileSearch },
  { id: "graph", label: "Decision graph", icon: Network },
  { id: "connections", label: "Connections", icon: Share2 },
];

function InvoiceContent() {
  const { invoiceId } = Route.useParams();
  const { user } = useSession();
  const { data } = useSuspenseQuery(invoiceQuery(user.id, invoiceId));
  const [view, setView] = useState<View>("review");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === "graph" || h === "connections" || h === "source") setView(h);
  }, []);
  const fileName = data?.invoice.fileName ?? null;
  const layout = useDocumentLayout(invoiceId, data?.record.version ?? 0, !!data && !!fileName);
  const focus = useMemo(
    () => ({
      focusKey,
      setFocusKey: (key: string | null) => {
        setFocusKey(key);
        if (key && !window.matchMedia("(min-width: 1280px)").matches) setView("source");
      },
      available: new Set((layout.data?.anchors ?? []).map((a) => a.key)),
    }),
    [focusKey, layout.data],
  );

  if (!data) {
    return (
      <div className="surface">
        <EmptyState
          icon={Lock}
          title="This invoice isn't available to you"
          body={`It doesn't exist, or ${ROLES[user.role].label}s can't see it. Switch demo identity to check another role's view.`}
        />
      </div>
    );
  }

  const record = data.record;
  const { action } = data;
  const target =
    action.kind === "approve"
      ? "approval"
      : ["review_bank_details", "resolve_issue"].includes(action.kind)
        ? "resolution"
        : ["prepare_payment", "release_payment", "simulate_settlement"].includes(action.kind)
          ? "payment"
          : null;
  const rawRefs = (id: string | undefined) =>
    record.validation_findings.find((f) => f.id === id)?.evidence_refs ?? [];
  // Blocking issues first, then advisory, so the most important card is on top.
  const ranked = [...data.invoice.findings].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  const issues = ranked.length;
  const covered = new Set(record.resolution_cases.flatMap((c) => c.finding_ids));
  const goTo = (id: string) => {
    setView("review");
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  return (
    <DocumentFocusContext.Provider value={focus}>
      <div className="space-y-4">
        <ReviewHeader
          detail={data}
          actionTarget={target}
          onAction={goTo}
          stagesNav={<StageChips record={record} onGo={goTo} />}
        />
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
            {VIEWS.map((v) => (
              <TabsTrigger
                key={v.id}
                value={v.id}
                className="gap-1.5 rounded-lg border border-transparent px-3 py-1.5 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-card"
              >
                <v.icon className="size-4" aria-hidden /> {v.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="review" className="mt-4">
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,9fr)_minmax(0,11fr)]">
              <aside
                className="hidden xl:sticky xl:top-[10.5rem] xl:block"
                aria-label="Original document"
              >
                <DocumentPane
                  invoiceId={invoiceId}
                  layout={layout.data}
                  fileName={fileName}
                  scanned={data.invoice.scanned}
                  onOpenSource={() => setView("source")}
                />
              </aside>
              <div className="min-w-0 space-y-6">
                {/* 1 · Detect: summary and the one next action */}
                <SentinelAnalysis
                  record={record}
                  findings={data.invoice.findings}
                  plainStatus={data.plainStatus}
                  actionLabel={action.label}
                  actionTarget={target}
                />

                {/* 2 · Resolve: what needs attention, ranked */}
                <section id="resolution" className="scroll-mt-36 space-y-3">
                  <StageHeading
                    n={2}
                    title={
                      issues
                        ? `Sentinel found ${issues} issue${issues === 1 ? "" : "s"}`
                        : "Needs attention"
                    }
                    note={
                      issues
                        ? "Blocking issues first. Each one explains why it matters and the safe way through."
                        : "Issues Sentinel found and the safe way through them."
                    }
                  />
                  {issues === 0 && record.resolution_cases.length === 0 && (
                    <p className="surface px-5 py-4 text-sm text-muted-foreground">
                      Nothing to resolve. All blocking checks passed.
                    </p>
                  )}
                  {record.resolution_cases.map((item) => (
                    <div key={item.id} className="space-y-2">
                      {ranked
                        .filter((f) => f.id && item.finding_ids.includes(f.id))
                        .map((f) => (
                          <div key={f.id} className="space-y-2">
                            <FindingCard finding={f} refs={rawRefs(f.id)} invoiceId={invoiceId} />
                            <DismissFinding record={record} findingId={f.id} />
                          </div>
                        ))}
                      <ResolutionCase id={item.id} />
                    </div>
                  ))}
                  {ranked
                    .filter((f) => !f.id || !covered.has(f.id))
                    .map((f) => (
                      <div key={f.id ?? f.code} className="space-y-2">
                        <FindingCard finding={f} refs={rawRefs(f.id)} invoiceId={invoiceId} />
                        <DismissFinding record={record} findingId={f.id} />
                      </div>
                    ))}
                  <DuplicateComparison record={record} />
                </section>

                {/* Machine learning, beside the decision it informs */}
                <CodingPanel key={record.version} record={record} />
                <AnomalyPanel anomaly={record.anomaly} />

                <details className="surface group px-5 py-4">
                  <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold">
                    All checks and record details
                    <ChevronDown
                      className="size-4 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <div className="mt-3 space-y-4">
                    <ChecksPanel detail={data} />
                    <ExtractedDetails detail={data} />
                  </div>
                </details>

                {/* 3 · Settle */}
                <section id="settle" className="scroll-mt-36 space-y-3">
                  <StageHeading
                    n={3}
                    title="Settle"
                    note="Approvals by the right people, then an independent simulated release."
                  />
                  <div id="approval" className="scroll-mt-36 space-y-3">
                    <ApprovalPanel detail={data} />
                    {record.allowed_actions.some(
                      (action) => action === "approve" || action === "reject",
                    ) && (
                      <div className="surface px-5 py-4">
                        <ApprovalDecision key={record.version} invoice={record} />
                      </div>
                    )}
                  </div>
                  <PaymentWorkflow invoice={record} />
                  <InvoiceCorrections key={record.version} invoice={record} />
                </section>

                {/* 4 · Explain */}
                <section id="explain" className="scroll-mt-36 space-y-3">
                  <StageHeading
                    n={4}
                    title="Explain"
                    note="Every recorded step, who did it and the evidence behind it."
                  />
                  <FlightRecorder invoiceId={invoiceId} />
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <button
                      type="button"
                      onClick={() => setView("graph")}
                      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      <Network className="size-4" aria-hidden /> See the same events as a decision
                      graph
                    </button>
                    {record.vendor_id && (
                      <Link
                        className="font-medium text-primary hover:underline"
                        to="/vendors"
                        search={{ vendorId: record.vendor_id, q: "", status: "" }}
                      >
                        View supplier profile
                      </Link>
                    )}
                  </div>
                  <details className="surface px-5 py-4 text-sm">
                    <summary className="cursor-pointer font-semibold">Version history</summary>
                    <ul className="mt-2 space-y-2">
                      {record.versions.map((version) => (
                        <li key={version.version}>
                          Version {version.version} · {version.reason} · {version.created_by} ·{" "}
                          {formatDate(version.created_at)}
                        </li>
                      ))}
                    </ul>
                  </details>
                </section>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="source" className="mt-4">
            <SourceReview
              invoiceId={invoiceId}
              record={record}
              fileName={fileName}
              scanned={data.invoice.scanned}
            />
          </TabsContent>
          <TabsContent value="graph" className="mt-4">
            <Suspense fallback={<Skeleton className="h-[460px] rounded-xl" />}>
              <DecisionGraph record={record} />
            </Suspense>
          </TabsContent>
          <TabsContent value="connections" className="mt-4">
            <Suspense fallback={<Skeleton className="h-[460px] rounded-xl" />}>
              <ConnectionsGraph record={record} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </DocumentFocusContext.Provider>
  );
}

/** Evidence-backed dismissal, only where the backend allows it for this finding. */
function DismissFinding({
  record,
  findingId,
}: {
  record: InvoiceRecord;
  findingId?: string | undefined;
}) {
  const { user } = useSession();
  if (
    !findingId ||
    !record.allowed_actions.includes("dismiss_finding") ||
    !record.validation_findings.some((f) => f.id === findingId && f.dismissible)
  )
    return null;
  return (
    <details className="surface px-5 py-4 text-sm">
      <summary className="cursor-pointer">Document dismissal</summary>
      <WorkflowForm
        label="Dismiss finding"
        run={(fields) =>
          api.dismiss(user.id, record.id, findingId, {
            expected_version: record.version,
            reason: value(fields, "reason"),
          })
        }
      >
        <Field name="reason" label="Evidence-backed reason" />
      </WorkflowForm>
    </details>
  );
}

/** Compact Detect → Resolve → Settle → Explain chips for the sticky header. */
function StageChips({ record, onGo }: { record: InvoiceRecord; onGo: (id: string) => void }) {
  const tone: Record<string, string> = {
    done: "bg-success-soft text-success-foreground",
    current: "bg-primary text-primary-foreground",
    blocked: "bg-critical-soft text-critical-foreground",
    locked: "bg-secondary text-muted-foreground",
    skipped: "bg-secondary text-muted-foreground",
  };
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Invoice progress">
      {stages(record).map((st, i) => (
        <li key={st.id} className="flex items-center gap-1">
          {i > 0 && <span className="h-px w-3 bg-border-strong" aria-hidden />}
          <button
            type="button"
            onClick={() => onGo(st.id === "detect" ? "detect" : st.id)}
            title={st.note}
            aria-current={st.state === "current" || st.state === "blocked" ? "step" : undefined}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80 ${tone[st.state]}`}
          >
            {st.label}
            <span className="sr-only"> · {st.note}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Side-by-side duplicate comparison, labelled candidate vs confirmed. */
function DuplicateComparison({ record }: { record: InvoiceRecord }) {
  if (!record.duplicate_candidates.length) return null;
  return (
    <section className="surface px-5 py-4" aria-labelledby="dupes-heading">
      <h3 id="dupes-heading" className="text-sm font-semibold">
        Possible duplicates
      </h3>
      <p className="text-xs text-muted-foreground">
        This invoice compared with the records Sentinel matched. A person makes the final call.
      </p>
      <ul className="mt-3 space-y-3">
        {record.duplicate_candidates.map((d) => (
          <li key={d.id} className="grid gap-3 rounded-xl border p-3 text-sm sm:grid-cols-2">
            <div>
              <p className="eyebrow">This invoice</p>
              <p className="font-medium">{record.vendor_name}</p>
              <p className="figure text-xs text-muted-foreground">
                #{record.invoice_number ?? "—"} · {formatDate(record.invoice_date)} ·{" "}
                {formatMoney(record.amount_minor, record.currency ?? "CAD")}
              </p>
            </div>
            <div>
              <p className="eyebrow flex items-center gap-2">
                Matched {d.matched_card_txn_id ? "card charge" : "invoice"}
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] normal-case tracking-normal ${
                    d.confirmed
                      ? "bg-critical-soft text-critical-foreground"
                      : "bg-warning-soft text-warning-foreground"
                  }`}
                >
                  {d.confirmed ? "Confirmed match" : "Candidate"} · score {d.score}
                </span>
              </p>
              {d.matched_invoice_id ? (
                <Link
                  className="font-medium text-primary hover:underline"
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: d.matched_invoice_id }}
                >
                  {d.matched_invoice_id}
                </Link>
              ) : (
                <p className="font-medium">{d.matched_card_txn_id}</p>
              )}
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {d.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StageHeading({ n, title, note }: { n: number; title: string; note: string }) {
  return (
    <header className="pt-2">
      <h2 className="text-base font-semibold tracking-tight">
        <span className="text-muted-foreground">{n} · </span>
        {title}
      </h2>
      <p className="text-xs text-muted-foreground">{note}</p>
    </header>
  );
}

function ReviewHeader({
  detail,
  actionTarget,
  onAction,
  stagesNav,
}: {
  detail: InvoiceDetail;
  actionTarget: string | null;
  onAction: (id: string) => void;
  stagesNav: React.ReactNode;
}) {
  const { invoice: inv, plainStatus, action } = detail;
  const blocking = inv.findings.find((f) => f.blocking);
  const held = inv.status === "on_hold";
  return (
    <section className="surface sticky top-2 z-30 overflow-hidden shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/95">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={inv.status} />
            <LanguageBadge language={inv.language} scanned={inv.scanned} />
            {inv.kind === "credit_note" ? (
              <span className="text-xs text-muted-foreground">
                Credit note — never scheduled as a payment
              </span>
            ) : null}
          </div>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{inv.supplierName}</h1>
          <p className="figure truncate text-xs text-muted-foreground">
            {inv.number ? `Invoice #${inv.number}` : "Invoice number unreadable"} · {inv.id} · Due{" "}
            {formatDate(inv.dueDate, { month: "short", day: "numeric", year: "numeric" })}
            {inv.dueDate ? ` (${dueLabel(inv.dueDate)})` : ""}
          </p>
        </div>
        <div className="text-right">
          <Money
            minor={inv.totalMinor}
            currency={inv.currency}
            className="text-xl font-semibold tracking-tight"
          />
          {inv.currency === "USD" && detail.amountCadMinor !== null ? (
            <p className="figure text-[11px] text-muted-foreground">
              ≈ {formatMoney(detail.amountCadMinor, "CAD")} CAD at {inv.fxToCad}
            </p>
          ) : null}
        </div>
        {actionTarget && (
          // A link, not a button: it takes you to the step; the action itself lives there.
          <Button asChild>
            <a
              href={`#${actionTarget}`}
              onClick={(e) => {
                e.preventDefault();
                onAction(actionTarget);
              }}
            >
              {action.label}
              <ArrowRight aria-hidden />
            </a>
          </Button>
        )}
      </div>
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-2 ${
          held
            ? "bg-critical-soft"
            : inv.status === "needs_review"
              ? "bg-warning-soft"
              : "bg-secondary/60"
        }`}
      >
        {held ? (
          <PauseCircle className="size-4 shrink-0 text-critical-foreground" aria-hidden />
        ) : (
          <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
        )}
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{held ? "Payment paused" : plainStatus}</span>
          <span className="text-muted-foreground">
            {" "}
            · {blocking ? blocking.title : `Owner: ${detail.owner}`}
          </span>
        </p>
        {stagesNav}
      </div>
    </section>
  );
}

function FindingCard({
  finding,
  refs,
  invoiceId,
}: {
  finding: Finding;
  refs: unknown[];
  invoiceId: string;
}) {
  const focus = useDocumentFocus();
  const anchorKey = anchorKeyForRefs(refs, invoiceId);
  const tone =
    finding.severity === "high"
      ? "border-l-critical"
      : finding.severity === "medium"
        ? "border-l-warning"
        : "border-l-border-strong";
  return (
    <article className={`surface border-l-4 ${tone} px-5 py-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">{finding.title}</h2>
        {finding.blocking ? (
          <span className="rounded-full bg-critical-soft px-2 py-px text-[11px] font-medium text-critical-foreground">
            Blocks payment
          </span>
        ) : (
          <span className="rounded-full bg-secondary px-2 py-px text-[11px] font-medium text-muted-foreground">
            Advisory
          </span>
        )}
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="eyebrow">Why this matters</dt>
          <dd className="mt-1 text-sm">{finding.whyItMatters}</dd>
        </div>
        <div>
          <dt className="eyebrow">What happens next</dt>
          <dd className="mt-1 text-sm">{finding.whatHappensNext}</dd>
        </div>
      </dl>
      <Collapsible className="mt-3">
        {anchorKey && focus && (
          <button
            type="button"
            onClick={() => focus.setFocusKey(anchorKey)}
            className="mr-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ScanSearch className="size-3.5" aria-hidden />
            {focus.available.has(anchorKey) ? "Show on document" : "Where on the document?"}
          </button>
        )}
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          See evidence{" "}
          <ChevronDown
            className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="collapsible-content">
          {refs.length > 0 ? (
            <Evidence items={refs} />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No supporting records attached.</p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            Check: {humanize(finding.code)} · deterministic rule
          </p>
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}

function Row({
  label,
  check,
  children,
}: {
  label: string;
  /** "ok" = read with confidence; "review" = missing or uncertain, a person must confirm. */
  check?: "ok" | "review";
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {check === "ok" && <CheckCircle2 className="size-3.5 text-success" aria-label="Read" />}
        {check === "review" && (
          <CircleHelp className="size-3.5 text-warning" aria-label="Needs a person" />
        )}
        {label}
      </dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

function ExtractedDetails({ detail }: { detail: InvoiceDetail }) {
  const inv = detail.invoice;
  const record = detail.record;
  return (
    <section aria-labelledby="extracted-heading">
      <h2 id="extracted-heading" className="text-sm font-semibold">
        Record details
      </h2>
      <p className="text-xs text-muted-foreground">
        Where this invoice sits in Brim. What was read from the document is shown above.
      </p>
      <dl className="mt-2 divide-y">
        <Row label="Department">{inv.department}</Row>
        <Row label="Version">{record.version}</Row>
        {record.remit["method"] != null && (
          <Row label="Payment route">
            {String(record.remit["method"])} {String(record.remit["account_masked"] ?? "")}
          </Row>
        )}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Details {humanize(record.provenance)}
        {record.uncertain_fields.length > 0 && (
          <span className="text-warning-foreground">
            {" "}
            · needs a person: {record.uncertain_fields.map(humanize).join(", ")}
          </span>
        )}
      </p>
      {record.evidence_refs.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">Source references</summary>
          <Evidence items={record.evidence_refs} />
        </details>
      )}
    </section>
  );
}

const CHECK_ICON: Record<CheckResult, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  PASS: { icon: CheckCircle2, cls: "text-success", label: "Passed" },
  FAIL: { icon: XCircle, cls: "text-critical", label: "Problem found" },
  UNKNOWN: { icon: CircleHelp, cls: "text-warning", label: "Couldn't check" },
  NOT_APPLICABLE: { icon: MinusCircle, cls: "text-muted-foreground", label: "Not applicable" },
};

function ChecksPanel({ detail }: { detail: InvoiceDetail }) {
  return (
    <section aria-labelledby="checks-heading">
      <h2 id="checks-heading" className="text-sm font-semibold">
        Checks
      </h2>
      <p className="text-xs text-muted-foreground">"Couldn't check" is never treated as a pass.</p>
      <ul className="mt-3 space-y-2.5">
        {detail.checks.map((c) => {
          const meta = CHECK_ICON[c.result];
          return (
            <li key={c.id ?? c.name} className="flex gap-2.5">
              <meta.icon className={`mt-0.5 size-4 shrink-0 ${meta.cls}`} aria-label={meta.label} />
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.note}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ApprovalPanel({ detail }: { detail: InvoiceDetail }) {
  const chain = detail.invoice.approvalChain;
  return (
    <section className="surface px-5 py-4" aria-labelledby="approval-heading">
      <h2 id="approval-heading" className="text-sm font-semibold">
        Approval chain
      </h2>
      {chain.length ? (
        <ol className="mt-3 space-y-3">
          {chain.map((s) => (
            <li key={s.order} className="flex gap-3">
              {s.status === "approved" ? (
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-success"
                  aria-label="Approved"
                />
              ) : s.status === "pending" ? (
                <CircleDashed
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-label="Current step"
                />
              ) : (
                <CircleDashed
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
                  aria-label="Not started"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">
                  {s.userName}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {ROLES[s.role].label}
                  </span>
                </p>
                {s.actingFor ? (
                  <p className="text-xs text-muted-foreground">
                    Acting for {s.actingFor} (on leave)
                  </p>
                ) : null}
                {s.note ? <p className="text-xs text-muted-foreground">{s.note}</p> : null}
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                  {s.rules.join(" + ")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          The approval chain is built once the checks pass.
        </p>
      )}
      {detail.record.blocked_reasons.length > 0 && (
        <ul className="mt-3 list-inside list-disc text-xs text-muted-foreground">
          {detail.record.blocked_reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Releaser: {detail.eligibleReleaser ?? "none listed"}
        </span>
        <SimulatedTag />
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <RiskIndicator risk={detail.invoice.risk} />
        <span>review priority — advisory only. Approvers never release their own invoices.</span>
      </p>
    </section>
  );
}
