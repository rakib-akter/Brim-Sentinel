import { Suspense } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/sentinel/empty-state";
import { GuidedDemo } from "@/components/sentinel/guided-demo";
import { PageHeader } from "@/components/sentinel/page-header";
import { TaskRow, TaskSection } from "@/components/sentinel/task-list";
import { UploadInvoiceDialog } from "@/components/sentinel/upload-invoice-dialog";
import { SimulatedTag } from "@/components/sentinel/badges";
import { homeQuery, invoicesQuery } from "@/lib/api/queries";
import { ROLES } from "@/lib/domain/roles";
import type { InvoiceStatusFilter } from "@/lib/domain/types";
import { formatDate, formatMoney, today } from "@/lib/format";
import { CountUp } from "@/components/sentinel/count-up";
import { plain } from "@/lib/plain-language";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Brim Sentinel" },
      {
        name: "description",
        content:
          "What needs your attention, what's ready for approval and which simulated payments are coming up.",
      },
      { property: "og:title", content: "Overview — Brim Sentinel" },
      {
        property: "og:description",
        content: "Your accounts payable tasks, prioritized with one clear next action each.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(homeQuery(context.actor)),
      context.queryClient.ensureQueryData(invoicesQuery(context.actor, {})),
    ]);
  },
  component: OverviewPage,
});

function OverviewPage() {
  const { user, permissions } = useSession();
  return (
    <div className="space-y-9">
      <PageHeader
        eyebrow={formatDate(today(), { weekday: "long", month: "long", day: "numeric" })}
        title="Your finance workspace"
        description={`A clear view of what needs attention, what is awaiting approval, and what happens next. Viewing as ${ROLES[user.role].label} (demo).`}
        actions={
          permissions.includes("invoice.upload") ? (
            <>
              <Button variant="outline" asChild>
                <Link to="/invoices">Open inbox</Link>
              </Button>
              <UploadInvoiceDialog />
            </>
          ) : null
        }
      />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewContent />
      </Suspense>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-[76px] rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-96 rounded-xl lg:col-span-3" />
        <Skeleton className="h-96 rounded-xl lg:col-span-2" />
      </div>
    </div>
  );
}

function OverviewContent() {
  const { user } = useSession();
  const { data } = useSuspenseQuery(homeQuery(user.id));
  const { data: invoices } = useSuspenseQuery(invoicesQuery(user.id, {}));
  const { metrics } = data;
  const attention = data.needsAttention.slice(0, 5);
  const held = data.needsAttention
    .filter((t) => t.record?.lifecycle_state === "ON_HOLD")
    .reduce((sum, t) => sum + (t.record?.amount_cad_minor ?? 0), 0);
  const top = attention[0];

  return (
    <>
      <section className="surface overflow-hidden" aria-label="Key numbers">
        <dl className="grid grid-cols-2 divide-y divide-border/70 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5 lg:divide-x lg:divide-border/70">
          <Kpi
            label="Invoices checked"
            value={invoices.length}
            hint="visible to your role"
            to="/invoices"
          />
          <Kpi
            label="Need a person"
            value={metrics.onHold}
            hint="payment paused or unclear"
            tone="critical"
            to="/invoices"
            search={{ status: "attention" }}
          />
          <Kpi
            label="Amount on hold"
            value={formatMoney(held, "CAD")}
            hint="CAD, until resolved"
            tone="critical"
          />
          <Kpi
            label="Ready for approval"
            value={metrics.readyForApproval}
            hint="awaiting a decision"
            to="/approvals"
          />
          <Kpi
            label="Simulated payments"
            value={metrics.upcomingPayments}
            hint="scheduled, no real money"
            to="/payments"
          />
        </dl>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {top && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Start here:</span>{" "}
              {top.invoice.supplierName} — {top.plainStatus.replace(/^Payment paused — /, "")}.
            </p>
          )}
          <TaskSection
            title="Needs your attention"
            description="Unresolved problems, suspicious activity or missing information — most urgent first."
            icon={AlertOctagon}
            count={data.needsAttention.length}
            footer={
              data.needsAttention.length > attention.length ? (
                <Button variant="link" size="sm" className="h-auto px-0" asChild>
                  <Link to="/invoices" search={{ status: "attention" }}>
                    View all {data.needsAttention.length} <ArrowRight aria-hidden />
                  </Link>
                </Button>
              ) : null
            }
          >
            {attention.length ? (
              <ul className="stagger divide-y">
                {attention.map((t) => (
                  <TaskRow key={t.invoice.id} task={t} />
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={CheckCircle2}
                title={user.role === "auditor" ? "Read-only view" : "Nothing needs you right now"}
                body={
                  user.role === "auditor"
                    ? "Auditors can review every record in the Audit Trail but don't resolve issues."
                    : "New problems will appear here as soon as invoices are checked."
                }
              />
            )}
          </TaskSection>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <TaskSection
            title="Ready for approval"
            description="Invoices waiting for a decision."
            icon={CheckSquare}
            count={data.readyForApproval.length}
            footer={
              data.readyForApproval.length > 4 ? (
                <Button variant="link" size="sm" className="h-auto px-0" asChild>
                  <Link to="/approvals">
                    View all {data.readyForApproval.length} <ArrowRight aria-hidden />
                  </Link>
                </Button>
              ) : null
            }
          >
            {data.readyForApproval.length ? (
              <ul className="stagger divide-y">
                {data.readyForApproval.slice(0, 4).map((t) => (
                  <TaskRow key={t.invoice.id} task={t} compact />
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={CheckSquare}
                title="No approvals waiting for you"
                body={
                  user.role === "ap_clerk" || user.role === "requester" || user.role === "auditor"
                    ? `${ROLES[user.role].label}s don't approve invoices. Switch demo identity to an approver to see this list.`
                    : "When an invoice reaches your step in the approval chain, it will show up here."
                }
              />
            )}
          </TaskSection>

          <TaskSection
            title="Upcoming payments"
            description="Approved invoices queued for simulated payment."
            icon={Wallet}
            count={data.upcomingPayments.length}
            footer={
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <SimulatedTag /> No real money moves in this prototype.
              </p>
            }
          >
            {data.upcomingPayments.length ? (
              <ul className="stagger divide-y">
                {data.upcomingPayments.map((t) => (
                  <TaskRow key={t.invoice.id} task={t} dateLabel="scheduled" compact />
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={Wallet}
                title="No payments scheduled"
                body="Approved invoices will queue here."
              />
            )}
          </TaskSection>
        </div>
      </div>

      <GuidedDemo />
      <details className="group border-t border-border/80 pt-5">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">How Sentinel works · Detect, Resolve, Settle, Explain</summary>
        <div className="mt-5"><HowSentinelHelps /></div>
      </details>

      {data.workItems.length > 0 && (
        <details id="intake-items" className="surface group overflow-hidden">
          <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-semibold">
            Intake work items ({data.workItems.length})
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <ul className="divide-y border-t">
            {data.workItems.map((item) => (
              <li key={item.id} className="px-5 py-3 text-sm">
                <p className="font-medium">{item.subject ?? plain(item.item_type)}</p>
                <p className="text-muted-foreground">
                  {plain(item.item_type)} · {plain(item.status)}
                  {item.note ? ` · ${item.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  to,
  search,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone?: "critical";
  to?: "/invoices" | "/approvals" | "/payments";
  search?: { status: InvoiceStatusFilter };
}) {
  const body = (
    <>
      <dt className="text-[11px] font-medium tracking-[0.015em] text-muted-foreground">{label}</dt>
      <dd
        className={`figure mt-2 text-[25px] leading-none font-semibold tracking-[-0.045em] ${
          tone === "critical" && value !== 0 ? "text-critical-foreground" : ""
        }`}
      >
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </dd>
      <dd className="mt-2 text-[11px] text-muted-foreground">{hint}</dd>
    </>
  );
  return (
    <div className="min-w-0">
      {to ? (
        <Link
          to={to}
          search={search as never}
          className="block h-full px-5 py-5 transition-colors hover:bg-secondary/40 md:px-6"
        >
          {body}
        </Link>
      ) : (
        <div className="px-5 py-5 md:px-6">{body}</div>
      )}
    </div>
  );
}

const HELP_STEPS = [
  {
    n: 1,
    title: "Detect",
    body: "Reads each invoice, suggests GL codes with ML and runs every control check.",
    to: "/invoices" as const,
    cta: "Invoice inbox",
  },
  {
    n: 2,
    title: "Resolve",
    body: "Opens an evidence-linked case with a safe path to pay; AI investigates read-only.",
    to: "/investigations" as const,
    cta: "Investigations",
  },
  {
    n: 3,
    title: "Settle",
    body: "The right people approve; an independent person releases a simulated payment.",
    to: "/payments" as const,
    cta: "Payments",
  },
  {
    n: 4,
    title: "Explain",
    body: "Every step is recorded in a tamper-evident trail you can replay.",
    to: "/audit" as const,
    cta: "Audit trail",
  },
];

function HowSentinelHelps() {
  return (
    <section aria-labelledby="how-heading">
      <h2 id="how-heading" className="text-sm font-semibold">
        How Sentinel helps
      </h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HELP_STEPS.map((s) => (
          <li key={s.n}>
            <Link to={s.to} className="surface lift flex h-full flex-col px-4 py-3.5">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid size-6 place-items-center rounded-full bg-primary-soft text-xs text-primary">
                  {s.n}
                </span>
                {s.title}
              </span>
              <span className="mt-1.5 flex-1 text-xs text-muted-foreground">{s.body}</span>
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                {s.cta} <ArrowRight className="size-3" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
