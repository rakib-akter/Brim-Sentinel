import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/sentinel/page-header";
import { QueryState } from "@/components/sentinel/query-state";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { analyticsQuery } from "@/lib/api/queries";
import type { AnalyticsOut, AnalyticsRow } from "@/lib/api/schema";
import { plain } from "@/lib/plain-language";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/analytics")({
  loader: ({ context }) => context.queryClient.prefetchQuery(analyticsQuery(context.actor)),
  head: () => ({
    meta: [
      { title: "Analytics — Brim Sentinel" },
      {
        name: "description",
        content: "Spend by month, department, supplier and category, plus workflow and payments.",
      },
    ],
  }),
  component: Analytics,
});

// One series per chart, so one hue. Light = brand violet; dark = the nearest step of the same hue
// that passes the chart lightness band on the dark card (validated with the dataviz palette check).
const CHART_CONFIG = {
  value: {
    label: "Value",
    theme: { light: "oklch(0.517 0.208 287.6)", dark: "oklch(0.66 0.18 290)" },
  },
} satisfies ChartConfig;

type Measure = "cad" | "count";

const cadFull = (minor: number) =>
  `CAD ${(minor / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function cadCompact(minor: number) {
  const v = minor / 100;
  if (Math.abs(v) >= 1_000_000) return `CAD ${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(v) >= 10_000) return `CAD ${Math.round(v / 1_000)}K`;
  return `CAD ${Math.round(v).toLocaleString("en-CA")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;

function Analytics() {
  const { user } = useSession();
  const q = useQuery(analyticsQuery(user.id));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oversight"
        title="Analytics"
        description={
          q.data
            ? `${q.data.scope_label} · computed from stored records, not estimates.`
            : "Spend, workload and payments, computed from stored records."
        }
      />
      {(q.error || q.isPending) && (
        <QueryState error={q.error} loading="Loading analytics…" retry={q.refetch} />
      )}
      {q.data && <Dashboard data={q.data} />}
    </div>
  );
}

function Dashboard({ data }: { data: AnalyticsOut }) {
  const k = data.kpis;
  return (
    <>
      <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Paid spend, Jan–Oct"
          value={cadCompact(k.spend_cad_minor)}
          title={cadFull(k.spend_cad_minor)}
        />
        <StatTile label="Paid invoices" value={k.paid_invoices.toLocaleString("en-CA")} />
        <StatTile label="Invoices in progress" value={String(k.in_workflow)} />
        <StatTile label="Payment paused" value={String(k.on_hold)} />
        <StatTile label="Waiting for approval" value={String(k.waiting_for_approval)} />
      </section>

      <BarCard
        title="Paid spend by month"
        description="Paid invoices by invoice month, CAD. October is partial."
        rows={data.spend_by_month.map((r) => ({ ...r, label: monthLabel(r.key) }))}
        measure="cad"
        vertical
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <BarCard
          title="Spend by department"
          description="Paid invoices, CAD."
          rows={data.spend_by_department}
          measure="cad"
        />
        <BarCard
          title="Top suppliers"
          description="Paid invoices, CAD. Smaller suppliers are grouped."
          rows={data.spend_by_vendor}
          measure="cad"
        />
        <BarCard
          title="Spend by category"
          description="Supplier category, paid invoices, CAD."
          rows={data.spend_by_category}
          measure="cad"
        />
        <BarCard
          title="Payments by method"
          description="Historical and simulated payments, CAD. Brim virtual card is the card method."
          rows={data.payment_methods}
          measure="cad"
          noun="payment"
        />
        <BarCard
          title="Incoming invoices by status"
          description="Invoices currently in Sentinel, by where they are."
          rows={data.processing_status.map((r) => ({ ...r, label: plain(r.key) }))}
          measure="count"
          empty="No invoices in progress."
        />
        <BarCard
          title="Why payments are paused"
          description="Blocking checks on paused invoices. One invoice can have several."
          rows={data.hold_reasons}
          measure="count"
          empty="Nothing is paused."
        />
        <BarCard
          title="Approvals waiting, by person"
          description="Approval steps not yet decided, including steps waiting for an earlier one."
          rows={data.approval_workload}
          measure="count"
          empty="No approvals waiting."
        />
        <BarCard
          title="Payments by status"
          description="Historical and simulated payments, CAD."
          rows={data.payment_status}
          measure="cad"
          noun="payment"
        />
      </div>

      <ul className="space-y-1 text-xs text-muted-foreground">
        {data.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}

function StatTile({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="surface px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="figure mt-1 text-2xl font-semibold tracking-tight" title={title}>
        {value}
      </p>
    </div>
  );
}

type Datum = { label: string; value: number; count: number; cad_minor: number };

function BarCard({
  title,
  description,
  rows,
  measure,
  vertical = false,
  empty = "No data in this view.",
  noun = "invoice",
}: {
  title: string;
  description: string;
  rows: AnalyticsRow[];
  measure: Measure;
  vertical?: boolean;
  empty?: string;
  noun?: "invoice" | "payment";
}) {
  const data: Datum[] = rows.map((r) => ({
    label: r.label,
    value: measure === "cad" ? r.cad_minor : r.count,
    count: r.count,
    cad_minor: r.cad_minor,
  }));
  const format = (v: number) => (measure === "cad" ? cadCompact(v) : v.toLocaleString("en-CA"));
  const height = vertical ? 260 : Math.max(120, data.length * 34 + 40);
  return (
    <section className="surface space-y-3 px-5 py-4" aria-label={title}>
      <header>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ChartContainer config={CHART_CONFIG} className="aspect-auto w-full" style={{ height }}>
          {vertical ? (
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} strokeWidth={1} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={format} tickLine={false} axisLine={false} width={72} />
              <ChartTooltip
                cursor={{ fillOpacity: 0.08 }}
                content={<Tip measure={measure} noun={noun} />}
              />
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
            </BarChart>
          ) : (
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
            >
              <CartesianGrid horizontal={false} strokeWidth={1} />
              <XAxis type="number" tickFormatter={format} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={170}
                tick={{ fontSize: 12 }}
              />
              <ChartTooltip
                cursor={{ fillOpacity: 0.08 }}
                content={<Tip measure={measure} noun={noun} />}
              />
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[0, 4, 4, 0]}
                maxBarSize={20}
              />
            </BarChart>
          )}
        </ChartContainer>
      )}
      {data.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">View as table</summary>
          <table className="mt-2 w-full text-left">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Name</th>
                <th className="py-1 text-right font-medium">
                  {noun === "payment" ? "Payments" : "Invoices"}
                </th>
                {measure === "cad" && <th className="py-1 text-right font-medium">Amount</th>}
              </tr>
            </thead>
            <tbody className="figure">
              {data.map((d) => (
                <tr key={d.label} className="border-t">
                  <td className="py-1">{d.label}</td>
                  <td className="py-1 text-right">{d.count.toLocaleString("en-CA")}</td>
                  {measure === "cad" && <td className="py-1 text-right">{cadFull(d.cad_minor)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function Tip({
  measure,
  noun,
  active,
  payload,
}: {
  measure: Measure;
  noun: "invoice" | "payment";
  active?: boolean;
  payload?: Array<{ payload: Datum }>;
}) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{d.label}</p>
      {measure === "cad" && <p className="figure">{cadFull(d.cad_minor)}</p>}
      <p className="text-muted-foreground">
        {d.count.toLocaleString("en-CA")} {d.count === 1 ? noun : `${noun}s`}
      </p>
    </div>
  );
}
