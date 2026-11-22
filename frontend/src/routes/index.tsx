import { Suspense, useDeferredValue, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  AlertOctagon,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  FileCheck2,
  PauseCircle,
  Search,
  SearchX,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/sentinel/empty-state";
import { InvoiceTable } from "@/components/sentinel/invoice-table";
import { MetricCard } from "@/components/sentinel/metric-card";
import { PageHeader } from "@/components/sentinel/page-header";
import { TaskRow, TaskSection } from "@/components/sentinel/task-list";
import { UploadInvoiceDialog } from "@/components/sentinel/upload-invoice-dialog";
import { SimulatedTag } from "@/components/sentinel/badges";
import { homeQuery, invoicesQuery } from "@/lib/api/queries";
import { ROLES } from "@/lib/domain/roles";
import { STATUS_FILTERS, STATUS_FILTER_LABELS } from "@/lib/domain/status-groups";
import type { InvoiceStatusFilter } from "@/lib/domain/types";
import { formatDate, TODAY } from "@/lib/format";
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
    <div className="space-y-8">
      <PageHeader
        eyebrow={formatDate(TODAY, { weekday: "long", month: "long", day: "numeric" })}
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description={`Here's what needs you today as ${ROLES[user.role].label}. Every item has one clear next step.`}
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[68px] rounded-xl" />
        ))}
      </div>
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
  const { metrics } = data;
  const attention = data.needsAttention.slice(0, 6);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link to="/approvals">
          <MetricCard
            label="Ready for approval"
            value={metrics.readyForApproval}
            hint="Awaiting a decision"
            icon={FileCheck2}
          />
        </Link>
        <a href="#intake-items">
          <MetricCard
            label="Open intake items"
            value={metrics.needsReview}
            hint="Waiting on a person"
            icon={ShieldAlert}
            tone="warning"
          />
        </a>
        <Link to="/invoices" search={{ status: "attention" }}>
          <MetricCard
            label="Payments on hold"
            value={metrics.onHold}
            hint="Paused until resolved"
            icon={PauseCircle}
            tone="critical"
          />
        </Link>
        <Link to="/payments">
          <MetricCard
            label="Upcoming payments"
            value={metrics.upcomingPayments}
            hint="Simulated"
            icon={CalendarClock}
            tone="info"
          />
        </Link>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
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
              <ul className="divide-y">
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

        <div className="space-y-6 lg:col-span-2">
          <TaskSection
            title="Ready for approval"
            description="Invoices waiting for a decision."
            icon={CheckSquare}
            count={data.readyForApproval.length}
          >
            {data.readyForApproval.length ? (
              <ul className="divide-y">
                {data.readyForApproval.map((t) => (
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
              <ul className="divide-y">
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

      <section id="intake-items" className="surface overflow-hidden">
        <h2 className="border-b px-5 py-3 font-semibold">Intake work items</h2>
        {data.workItems.length ? (
          <ul className="divide-y">
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
        ) : (
          <p className="px-5 py-3 text-sm text-muted-foreground">
            No intake work items in this view.
          </p>
        )}
      </section>
      <AllInvoices />
    </>
  );
}

function AllInvoices() {
  const { user } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<InvoiceStatusFilter>("all");
  const params = useDeferredValue({ q, status });
  const { data } = useSuspenseQuery(invoicesQuery(user.id, params));

  return (
    <section className="surface overflow-hidden" aria-labelledby="all-invoices-heading">
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <div className="mr-auto">
          <h2 id="all-invoices-heading" className="text-[15px] font-semibold tracking-tight">
            All invoices
          </h2>
          <p className="text-xs text-muted-foreground">Search and filter everything you can see.</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search invoices"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Supplier or invoice #"
            className="h-9 pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatusFilter)}>
          <SelectTrigger className="h-9 w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {STATUS_FILTER_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      {data.length ? (
        <InvoiceTable tasks={data} caption="All invoices" />
      ) : (
        <EmptyState
          compact
          icon={SearchX}
          title="No invoices match"
          body="Try a different supplier name, invoice number or status."
        />
      )}
    </section>
  );
}
