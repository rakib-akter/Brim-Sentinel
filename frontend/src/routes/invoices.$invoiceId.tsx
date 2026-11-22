import { Suspense } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
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
import {
  CodingPanel,
  DocumentPanel,
  ProgressRail,
  SentinelAnalysis,
} from "@/components/sentinel/invoice-workspace";
import { PaymentWorkflow } from "@/components/sentinel/payment-workflow";
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

function InvoiceContent() {
  const { invoiceId } = Route.useParams();
  const { user } = useSession();
  const { data } = useSuspenseQuery(invoiceQuery(user.id, invoiceId));

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
  return (
    <div className="space-y-4">
      <ReviewHeader detail={data} />
      <ProgressRail record={record} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="xl:sticky xl:top-4">
          <DocumentPanel
            invoiceId={invoiceId}
            fileName={data.invoice.fileName}
            scanned={data.invoice.scanned}
          />
        </div>
        <div className="min-w-0 space-y-6">
          {/* 1 · Detect */}
          <SentinelAnalysis
            record={record}
            findings={data.invoice.findings}
            plainStatus={data.plainStatus}
            actionLabel={action.label}
            actionTarget={target}
          />
          <ExtractedDetails detail={data} />
          <CodingPanel key={record.version} record={record} />
          <ChecksPanel detail={data} />

          {/* 2 · Resolve */}
          <section id="resolution" className="scroll-mt-4 space-y-3">
            <StageHeading
              n={2}
              title="Resolve"
              note="Issues Sentinel found and the safe way through them."
            />
            {data.invoice.findings.length === 0 && record.resolution_cases.length === 0 && (
              <p className="surface px-5 py-4 text-sm text-muted-foreground">
                Nothing to resolve. All blocking checks passed.
              </p>
            )}
            {record.resolution_cases.map((item) => (
              <ResolutionCase key={item.id} id={item.id} />
            ))}
            {data.invoice.findings.map((f) => (
              <div key={f.id ?? f.code} className="space-y-2">
                <FindingCard finding={f} refs={rawRefs(f.id)} />
                {f.id &&
                  record.allowed_actions.includes("dismiss_finding") &&
                  record.validation_findings.some(
                    (finding) => finding.id === f.id && finding.dismissible,
                  ) && (
                    <details className="surface px-5 py-4 text-sm">
                      <summary className="cursor-pointer">Document dismissal</summary>
                      <WorkflowForm
                        label="Dismiss finding"
                        run={(fields) =>
                          api.dismiss(user.id, invoiceId, f.id!, {
                            expected_version: record.version,
                            reason: value(fields, "reason"),
                          })
                        }
                      >
                        <Field name="reason" label="Evidence-backed reason" />
                      </WorkflowForm>
                    </details>
                  )}
              </div>
            ))}
          </section>

          {/* 3 · Settle */}
          <section id="settle" className="scroll-mt-4 space-y-3">
            <StageHeading
              n={3}
              title="Settle"
              note="Approvals by the right people, then an independent simulated release."
            />
            <div id="approval" className="space-y-3">
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
          <section id="explain" className="scroll-mt-4 space-y-3">
            <StageHeading
              n={4}
              title="Explain"
              note="Every recorded step, who did it and the evidence behind it."
            />
            <FlightRecorder invoiceId={invoiceId} />
            {record.vendor_id && (
              <Link
                className="inline-block text-sm font-medium text-primary hover:underline"
                to="/vendors"
                search={{ vendorId: record.vendor_id, q: "", status: "" }}
              >
                View supplier profile
              </Link>
            )}
            <details className="surface px-5 py-4 text-sm">
              <summary className="cursor-pointer font-semibold">
                Version history and supporting records
              </summary>
              <ul className="mt-2 space-y-2">
                {record.versions.map((version) => (
                  <li key={version.version}>
                    Version {version.version} · {version.reason} · {version.created_by} ·{" "}
                    {formatDate(version.created_at)}
                  </li>
                ))}
                {record.duplicate_candidates.map((candidate) => (
                  <li key={candidate.id}>
                    {humanize(candidate.match_type)} ·{" "}
                    {candidate.matched_card_txn_id ?? candidate.matched_invoice_id} ·{" "}
                    {candidate.reasons.join(", ")}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </div>
      </div>
    </div>
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

function ReviewHeader({ detail }: { detail: InvoiceDetail }) {
  const { invoice: inv, plainStatus } = detail;
  const blocking = inv.findings.find((f) => f.blocking);

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-start gap-6 px-6 py-5">
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
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{inv.supplierName}</h1>
          <p className="figure mt-0.5 text-sm text-muted-foreground">
            {inv.number ? `Invoice #${inv.number}` : "Invoice number unreadable"} · {inv.id} ·{" "}
            {inv.sourceRef}
          </p>
        </div>
        <div className="text-right">
          <Money
            minor={inv.totalMinor}
            currency={inv.currency}
            className="text-2xl font-semibold tracking-tight"
          />
          {inv.currency === "USD" && detail.amountCadMinor !== null ? (
            <p className="figure text-xs text-muted-foreground">
              ≈ {formatMoney(detail.amountCadMinor, "CAD")} CAD at {inv.fxToCad} (invoice-date rate)
            </p>
          ) : null}
          <p className="figure mt-1 text-xs text-muted-foreground">
            Due {formatDate(inv.dueDate, { month: "short", day: "numeric", year: "numeric" })}
            {inv.dueDate ? ` · ${dueLabel(inv.dueDate)}` : ""}
          </p>
        </div>
      </div>
      <div
        className={`flex flex-wrap items-center gap-4 border-t px-6 py-4 ${
          inv.status === "on_hold"
            ? "bg-critical-soft"
            : inv.status === "needs_review"
              ? "bg-warning-soft"
              : "bg-secondary/60"
        }`}
      >
        {inv.status === "on_hold" ? (
          <PauseCircle className="size-5 shrink-0 text-critical-foreground" aria-hidden />
        ) : (
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {inv.status === "on_hold" ? "Payment paused" : plainStatus}
          </p>
          <p className="text-sm text-muted-foreground">
            {blocking
              ? blocking.whyItMatters
              : (inv.findings[0]?.whyItMatters ?? `Owner: ${detail.owner}.`)}
          </p>
        </div>
      </div>
    </section>
  );
}

function FindingCard({ finding, refs }: { finding: Finding; refs: unknown[] }) {
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
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          See evidence{" "}
          <ChevronDown
            className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {refs.length > 0 ? (
            <Evidence items={refs} />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No supporting records attached.</p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            Check: {humanize(finding.code)}
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
  const unknown = <span className="text-warning-foreground">Needs a person</span>;
  const record = detail.record;
  const uncertain = new Set(record.uncertain_fields);
  const check = (present: boolean, ...keys: string[]): "ok" | "review" =>
    present && !keys.some((k) => uncertain.has(k)) ? "ok" : "review";
  const read = [inv.number, inv.issueDate, inv.subtotalMinor, inv.totalMinor].filter(
    (v) => v !== null && v !== undefined,
  ).length;
  return (
    <section className="surface rise-in px-5 py-4" aria-labelledby="extracted-heading">
      <h2 id="extracted-heading" className="text-sm font-semibold">
        Extracted details
      </h2>
      <p className="text-xs text-muted-foreground">
        {read} of 4 key fields read · ✓ means read from the document, ? means a person must confirm.
      </p>
      <dl className="mt-2 divide-y">
        <Row label="Supplier" check={check(!!inv.supplierName, "vendor", "vendor_name")}>
          {inv.supplierName}
        </Row>
        <Row label="Invoice number" check={check(!!inv.number, "invoice_number")}>
          {inv.number ? <span className="figure">{inv.number}</span> : unknown}
        </Row>
        <Row label="Issued" check={check(!!inv.issueDate, "invoice_date")}>
          {inv.issueDate ? (
            <span className="figure">
              {formatDate(inv.issueDate, { year: "numeric", month: "short", day: "numeric" })}
            </span>
          ) : (
            unknown
          )}
        </Row>
        <Row label="Subtotal" check={check(inv.subtotalMinor !== null, "subtotal")}>
          {inv.subtotalMinor === null ? (
            unknown
          ) : (
            <Money minor={inv.subtotalMinor} currency={inv.currency} />
          )}
        </Row>
        {inv.taxes.map((t) => (
          <Row key={t.label} label={t.label}>
            <Money minor={t.amountMinor} currency={inv.currency} showCode={false} />
          </Row>
        ))}
        <Row label="Total" check={check(inv.totalMinor !== null, "total")}>
          {inv.totalMinor === null ? (
            unknown
          ) : (
            <Money minor={inv.totalMinor} currency={inv.currency} className="font-semibold" />
          )}
        </Row>
        <Row label="Department">{inv.department}</Row>
        <Row label="Version">{record.version}</Row>
        {record.remit["method"] != null && (
          <Row label="Payment route">
            {String(record.remit["method"])} {String(record.remit["account_masked"] ?? "")}
          </Row>
        )}
        {inv.poNumber ? (
          <Row label="Purchase order">
            <span className="figure">{inv.poNumber}</span>
          </Row>
        ) : null}
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
      {record.anomaly && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">Review priority</summary>
          <p className="mt-2 text-muted-foreground">{record.anomaly.label}</p>
          {record.anomaly.status === "INSUFFICIENT_HISTORY" && (
            <p>
              Limited supplier history ·{" "}
              {String(record.anomaly.inputs["history_count"] ?? "Unknown")} prior invoices
            </p>
          )}
          <ul className="mt-1">
            {record.anomaly.signals.map((signal, index) => (
              <li key={index}>{String(signal["explanation"] ?? "")}</li>
            ))}
          </ul>
        </details>
      )}
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
    <section className="surface px-5 py-4" aria-labelledby="checks-heading">
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
