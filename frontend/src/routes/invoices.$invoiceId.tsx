import { Suspense } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleHelp,
  FileText,
  Lock,
  MinusCircle,
  PauseCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/sentinel/empty-state";
import { LanguageBadge, RiskIndicator, SimulatedTag, StatusBadge } from "@/components/sentinel/badges";
import { Money } from "@/components/sentinel/money";
import { invoiceQuery } from "@/lib/api/queries";
import { DEFAULT_USER_ID, ROLES } from "@/lib/domain/roles";
import type { CheckResult, Finding, InvoiceDetail } from "@/lib/domain/types";
import { dueLabel, formatDate, formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/invoices/$invoiceId")({
  head: ({ params }) => ({
    meta: [
      { title: `Invoice ${params.invoiceId} — Brim Sentinel` },
      { name: "description", content: "Invoice review: source document, extracted details, checks and the next safe step." },
      { property: "og:title", content: `Invoice ${params.invoiceId} — Brim Sentinel` },
      { property: "og:description", content: "Plain-language invoice review with evidence-backed checks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(invoiceQuery(DEFAULT_USER_ID, params.invoiceId)),
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

  return (
    <div className="space-y-6">
      <ReviewHeader detail={data} />
      <div className="grid items-start gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {data.invoice.findings.map((f) => (
            <FindingCard key={f.code} finding={f} />
          ))}
          <DocumentPreview detail={data} />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <ExtractedDetails detail={data} />
          <ChecksPanel detail={data} />
          <ApprovalPanel detail={data} />
        </div>
      </div>
    </div>
  );
}

function ReviewHeader({ detail }: { detail: InvoiceDetail }) {
  const { invoice: inv, action, plainStatus } = detail;
  const blocking = inv.findings.find((f) => f.blocking);
  const onAction = () =>
    toast("Coming in the next build step", {
      description: "Guided resolution and approvals are part of Phase 2. Nothing has been changed.",
    });

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-start gap-6 px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={inv.status} />
            <LanguageBadge language={inv.language} scanned={inv.scanned} />
            {inv.kind === "credit_note" ? <span className="text-xs text-muted-foreground">Credit note — never scheduled as a payment</span> : null}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{inv.supplierName}</h1>
          <p className="figure mt-0.5 text-sm text-muted-foreground">
            {inv.number ? `Invoice #${inv.number}` : "Invoice number unreadable"} · {inv.id} · {inv.sourceRef}
          </p>
        </div>
        <div className="text-right">
          <Money minor={inv.totalMinor} currency={inv.currency} className="text-2xl font-semibold tracking-tight" />
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
          inv.status === "on_hold" ? "bg-critical-soft" : inv.status === "needs_review" ? "bg-warning-soft" : "bg-secondary/60"
        }`}
      >
        {inv.status === "on_hold" ? (
          <PauseCircle className="size-5 shrink-0 text-critical-foreground" aria-hidden />
        ) : (
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{inv.status === "on_hold" ? "Payment paused" : plainStatus}</p>
          <p className="text-sm text-muted-foreground">
            {blocking ? blocking.whyItMatters : inv.findings[0]?.whyItMatters ?? `Owner: ${detail.owner}.`}
          </p>
        </div>
        {action.disabled ? null : action.kind === "view_record" ||
          action.kind === "view_payment" ||
          action.kind === "view_approval" ? null : (
          <Button onClick={onAction}>
            {action.kind === "review_bank_details" ? "Start verification" : action.label}
            <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </section>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
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
          See evidence <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {finding.evidenceIds.map((id) => (
              <span key={id} className="figure rounded-md border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {id}
              </span>
            ))}
            <span className="figure rounded-md bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              rule {finding.code}
            </span>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}

function DocumentPreview({ detail }: { detail: InvoiceDetail }) {
  const inv = detail.invoice;
  return (
    <section className="surface overflow-hidden" aria-labelledby="doc-heading">
      <header className="flex items-center gap-2 border-b px-5 py-3">
        <FileText className="size-4 text-muted-foreground" aria-hidden />
        <h2 id="doc-heading" className="text-sm font-semibold">Source document</h2>
        <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{inv.fileName ?? "No file attached"}</span>
      </header>
      <div className="dot-grid bg-secondary/40 p-6">
        {inv.fileName ? (
          <div className="mx-auto max-w-xl rounded-md bg-card p-8 shadow-raised">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-base font-semibold">{inv.supplierName}</p>
                <p className="text-xs text-muted-foreground">{inv.language === "fr" ? "Facture" : "Invoice"}</p>
              </div>
              <div className="text-right text-xs">
                <p className="figure font-medium">{inv.number ? `No. ${inv.number}` : "No. ▒▒▒▒"}</p>
                <p className="figure text-muted-foreground">{formatDate(inv.issueDate, { year: "numeric", month: "short", day: "numeric" })}</p>
              </div>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">Bill to: Harborline Logistics Inc.</p>
            <table className="mt-4 w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5 font-medium">{inv.language === "fr" ? "Description" : "Description"}</th>
                  <th className="py-1.5 text-right font-medium">{inv.language === "fr" ? "Qté" : "Qty"}</th>
                  <th className="py-1.5 text-right font-medium">{inv.language === "fr" ? "Montant" : "Amount"}</th>
                </tr>
              </thead>
              <tbody>
                {inv.lineItems.length ? (
                  inv.lineItems.map((l) => (
                    <tr key={l.description} className="border-b border-dashed">
                      <td className="py-1.5 pr-2">{l.description}</td>
                      <td className="figure py-1.5 text-right">{l.quantity}</td>
                      <td className="figure py-1.5 text-right">{formatMoney(l.quantity * l.unitPriceMinor, inv.currency)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-muted-foreground">
                      ▒▒▒▒▒▒▒▒ ▒▒▒▒▒ ▒▒▒▒▒▒ — text could not be read
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="ml-auto mt-4 w-56 space-y-1 text-xs">
              {inv.taxes.map((t) => (
                <div key={t.label} className="flex justify-between text-muted-foreground">
                  <span>{t.label}</span>
                  <span className="figure">{formatMoney(t.amountMinor, inv.currency)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="figure">{inv.totalMinor === null ? "▒▒▒▒" : formatMoney(inv.totalMinor, inv.currency)}</span>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState compact icon={FileText} title="No document received" body="The email said an invoice was attached, but no file arrived." />
        )}
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Preview rendered from sample data. The original PDF or image will display here once the backend is connected.
        </p>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

function ExtractedDetails({ detail }: { detail: InvoiceDetail }) {
  const inv = detail.invoice;
  const unknown = <span className="text-warning-foreground">Needs a person</span>;
  return (
    <section className="surface px-5 py-4" aria-labelledby="extracted-heading">
      <h2 id="extracted-heading" className="text-sm font-semibold">Invoice details</h2>
      <dl className="mt-2 divide-y">
        <Row label="Supplier">{inv.supplierName}</Row>
        <Row label="Invoice number">{inv.number ? <span className="figure">{inv.number}</span> : unknown}</Row>
        <Row label="Issued">{inv.issueDate ? <span className="figure">{formatDate(inv.issueDate, { year: "numeric", month: "short", day: "numeric" })}</span> : unknown}</Row>
        <Row label="Subtotal">{inv.subtotalMinor === null ? unknown : <Money minor={inv.subtotalMinor} currency={inv.currency} />}</Row>
        {inv.taxes.map((t) => (
          <Row key={t.label} label={t.label}>
            <Money minor={t.amountMinor} currency={inv.currency} showCode={false} />
          </Row>
        ))}
        <Row label="Total">{inv.totalMinor === null ? unknown : <Money minor={inv.totalMinor} currency={inv.currency} className="font-semibold" />}</Row>
        <Row label="Department">{inv.department}</Row>
        {inv.poNumber ? <Row label="Purchase order"><span className="figure">{inv.poNumber}</span></Row> : null}
      </dl>
      {inv.suggestedGl ? (
        <div className="mt-3 rounded-lg bg-secondary/70 px-3 py-2.5">
          <p className="eyebrow">Suggested accounting code</p>
          <p className="mt-1 text-sm">
            <span className="figure font-medium">{inv.suggestedGl.code}</span> · {inv.suggestedGl.name}
          </p>
          <Collapsible>
            <CollapsibleTrigger className="group mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View details <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="figure mt-1 text-xs text-muted-foreground">
                Model confidence {(inv.suggestedGl.confidence * 100).toFixed(0)}%
                {inv.suggestedGl.confidence < 0.7 ? " — below the 70% threshold, so a person must confirm it." : "."} Sample value.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
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
      <h2 id="checks-heading" className="text-sm font-semibold">Checks</h2>
      <p className="text-xs text-muted-foreground">"Couldn't check" is never treated as a pass.</p>
      <ul className="mt-3 space-y-2.5">
        {detail.checks.map((c) => {
          const meta = CHECK_ICON[c.result];
          return (
            <li key={c.name} className="flex gap-2.5">
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
      <h2 id="approval-heading" className="text-sm font-semibold">Approval & payment</h2>
      {chain.length ? (
        <ol className="mt-3 space-y-3">
          {chain.map((s) => (
            <li key={s.order} className="flex gap-3">
              {s.status === "approved" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Approved" />
              ) : s.status === "pending" ? (
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Current step" />
              ) : (
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-label="Not started" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">
                  {s.userName}
                  <span className="font-normal text-muted-foreground"> · {ROLES[s.role].label}</span>
                </p>
                {s.actingFor ? <p className="text-xs text-muted-foreground">Acting for {s.actingFor} (on leave)</p> : null}
                {s.note ? <p className="text-xs text-muted-foreground">{s.note}</p> : null}
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">{s.rules.join(" + ")}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">The approval chain is built once the checks pass.</p>
      )}
      <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Releaser: {detail.eligibleReleaser ?? "nobody eligible yet — escalation required"}
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
