import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock3, FileText, Layers3, Sparkles } from "lucide-react";
import { useState } from "react";
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
        title="Financial Analytics"
        description={
          q.data
            ? `AP performance, spend trends, and payments at a glance. ${q.data.scope_label} · Actual stored records.`
            : "AP performance, spend trends, and payments at a glance."
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
  const [tab, setTab] = useState<"performance" | "spend" | "payments" | "anomalies" | "trends">("performance");
  const monthly = data.spend_by_month.map((r) => ({ ...r, label: monthLabel(r.key) }));
  const categories = data.spend_by_category.filter((r) => r.cad_minor > 0);
  const totalCategory = categories.reduce((sum, row) => sum + row.cad_minor, 0);
  const supplierTotal = data.spend_by_vendor.reduce((sum, row) => sum + row.cad_minor, 0);
  const palette = ["#6040cf", "#8667e9", "#a58cf1", "#c2b2f7", "#dcd4fb", "#ece8fc"];
  const tabs = [
    { id: "performance", label: "AP Performance" },
    { id: "spend", label: "Spend & Suppliers" },
    { id: "payments", label: "Payments" },
    { id: "anomalies", label: "Anomalies" },
    { id: "trends", label: "Trends" },
  ] as const;
  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Analytics views">
        {tabs.map((item) => (
          <button key={item.id} role="tab" aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`shrink-0 border-b-2 px-4 pb-3 pt-1 text-[13px] font-medium transition-colors ${tab === item.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === "performance" && (
        <>
          <section aria-label="Key financial metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PremiumStat icon={FileText} label="Total AP Spend" value={cadCompact(k.spend_cad_minor)} note="Paid invoices · CAD" />
            <PremiumStat icon={Layers3} label="Invoices Processed" value={String(k.paid_invoices)} note="Completed payments" />
            <PremiumStat icon={Clock3} label="In Progress" value={String(k.in_workflow)} note="Currently in workflow" />
            <PremiumStat icon={AlertTriangle} label="Payments Paused" value={String(k.on_hold)} note="Require resolution" warning />
          </section>
          <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
            <section className="surface min-w-0 p-5 md:p-6">
              <h2 className="text-[16px] font-semibold tracking-tight">AP Spend Over Time</h2>
              <p className="mt-1 text-xs text-muted-foreground">Paid invoice value by invoice month · CAD</p>
              {monthly.length ? (
                <div className="mt-6 h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthly} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <defs><linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7651df" stopOpacity={0.24}/><stop offset="100%" stopColor="#7651df" stopOpacity={0.015}/></linearGradient></defs>
                      <CartesianGrid vertical={false} stroke="#e9eaf2" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#69738a" }} />
                      <YAxis tickFormatter={cadCompact} tickLine={false} axisLine={false} width={72} tick={{ fontSize: 11, fill: "#69738a" }} />
                      <ChartTooltip content={<Tip measure="cad" noun="invoice" />} />
                      <Area dataKey="cad_minor" type="monotone" stroke="#6846d6" strokeWidth={2.5} fill="url(#spendGradient)" dot={{ r: 3, fill: "#6846d6" }} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="mt-6 text-sm text-muted-foreground">No monthly spend data available.</p>}
            </section>
            <section className="surface min-w-0 p-5 md:p-6">
              <h2 className="text-[16px] font-semibold tracking-tight">Spend by Category</h2>
              <p className="mt-1 text-xs text-muted-foreground">Share of paid invoice spend</p>
              {categories.length ? (
                <div className="mt-4 flex flex-col items-center gap-4 lg:flex-row">
                  <div className="relative h-[235px] w-[235px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={categories} dataKey="cad_minor" nameKey="label" innerRadius={72} outerRadius={103} stroke="none" paddingAngle={1.5}>
                        {categories.map((row, i) => <Cell key={row.key} fill={palette[i % palette.length]} />)}
                      </Pie><ChartTooltip formatter={(v) => cadFull(Number(v))}/></PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="figure text-xl font-semibold tracking-tight">{cadCompact(totalCategory)}</span>
                      <span className="text-[11px] text-muted-foreground">Total spend</span>
                    </div>
                  </div>
                  <div className="w-full min-w-0 space-y-3">
                    {categories.slice(0, 6).map((row, i) => (
                      <div key={row.key} className="flex items-center gap-2 text-xs">
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: palette[i % palette.length] }} />
                        <span className="min-w-0 flex-1 truncate" title={row.label}>{row.label}</span>
                        <span className="figure text-muted-foreground">{totalCategory ? (100 * row.cad_minor / totalCategory).toFixed(1) : "0.0"}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="mt-6 text-sm text-muted-foreground">No category spend available.</p>}
            </section>
          </div>
          <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
            <section className="surface p-5 md:p-6">
              <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-tight"><Sparkles className="size-4 text-primary"/> Operational insights</h2>
              <div className="mt-5 space-y-3">
                <Insight label="Payments completed" value={`${k.paid_invoices} paid invoices recorded`} />
                <Insight label="Attention required" value={`${k.on_hold} payments currently paused`} warning />
                <Insight label="Approval pipeline" value={`${k.waiting_for_approval} awaiting approval`} />
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground">Insights summarize current records; no unverified trend claims.</p>
            </section>
            <section className="surface min-w-0 p-5 md:p-6">
              <h2 className="text-[16px] font-semibold tracking-tight">Top Suppliers by Spend</h2>
              <p className="mt-1 text-xs text-muted-foreground">Paid invoices · CAD</p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/70 text-muted-foreground"><tr><th className="rounded-l-md px-3 py-2 font-medium">Supplier</th><th className="px-3 py-2 text-right font-medium">Invoices</th><th className="px-3 py-2 text-right font-medium">Spend (CAD)</th><th className="rounded-r-md px-3 py-2 text-right font-medium">% of total</th></tr></thead>
                  <tbody className="divide-y divide-border/80">{data.spend_by_vendor.slice(0, 6).map((row) => (
                    <tr key={row.key}><td className="max-w-[180px] truncate px-3 py-3 font-medium" title={row.label}>{row.label}</td><td className="figure px-3 py-3 text-right">{row.count}</td><td className="figure whitespace-nowrap px-3 py-3 text-right">{cadCompact(row.cad_minor)}</td><td className="figure px-3 py-3 text-right">{supplierTotal ? (row.cad_minor / supplierTotal * 100).toFixed(1) : "0.0"}%</td></tr>
                  ))}</tbody>
                </table>
                {!data.spend_by_vendor.length && <p className="py-6 text-sm text-muted-foreground">No paid suppliers to display.</p>}
              </div>
            </section>
          </div>
        </>
      )}
      {tab === "spend" && <div className="grid gap-5 xl:grid-cols-2"><BarCard title="Spend by department" description="Paid invoices, CAD." rows={data.spend_by_department} measure="cad" /><BarCard title="Top suppliers" description="Paid invoices, CAD." rows={data.spend_by_vendor} measure="cad" /><BarCard title="Spend by category" description="Paid invoices, CAD." rows={data.spend_by_category} measure="cad" /></div>}
      {tab === "payments" && <div className="grid gap-5 xl:grid-cols-2"><BarCard title="Payments by method" description="Historical and simulated payments, CAD." rows={data.payment_methods} measure="cad" noun="payment" /><BarCard title="Payments by status" description="Historical and simulated payments, CAD." rows={data.payment_status} measure="cad" noun="payment" /></div>}
      {tab === "anomalies" && <div className="grid gap-5 xl:grid-cols-2"><BarCard title="Why payments are paused" description="Blocking checks; an invoice may have multiple." rows={data.hold_reasons} measure="count" /><BarCard title="Incoming invoices by status" description="Current invoice processing state." rows={data.processing_status.map((r) => ({ ...r, label: plain(r.key) }))} measure="count" /></div>}
      {tab === "trends" && <div className="grid gap-5 xl:grid-cols-2"><BarCard title="Paid spend by month" description="Invoice month · CAD" rows={monthly} measure="cad" vertical /><BarCard title="Approvals waiting, by person" description="Undecided approval steps." rows={data.approval_workload} measure="count" /></div>}
      <div className="space-y-1 border-t border-border pt-4 text-[11px] text-muted-foreground">{data.notes.map((n) => <p key={n}>{n}</p>)}</div>
    </div>
  );
}

function PremiumStat({ icon: Icon, label, value, note, warning = false }: { icon: typeof FileText; label: string; value: string; note: string; warning?: boolean }) {
  return <div className="surface flex items-start gap-3 px-4 py-5">
    <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${warning ? "bg-critical-soft text-critical-foreground" : "bg-primary-soft text-primary"}`}><Icon className="size-5" strokeWidth={1.8}/></div>
    <div className="min-w-0"><p className="text-[12px] font-medium text-muted-foreground">{label}</p><p className="figure mt-1 text-[26px] font-semibold leading-none tracking-[-0.045em]">{value}</p><p className="mt-2 text-[11px] text-muted-foreground">{note}</p></div>
  </div>;
}

function Insight({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-3">
    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${warning ? "bg-critical-soft text-critical-foreground" : "bg-primary-soft text-primary"}`}>{warning ? <ArrowUpRight className="size-4"/> : <ArrowDownRight className="size-4"/>}</span>
    <div><p className="text-[12px] font-semibold">{label}</p><p className="text-[11px] text-muted-foreground">{value}</p></div>
  </div>;
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
