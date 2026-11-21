import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: LucideIcon;
  tone?: "neutral" | "warning" | "critical" | "info";
}) {
  const toneCls = {
    neutral: "bg-primary-soft text-primary",
    warning: "bg-warning-soft text-warning-foreground",
    critical: "bg-critical-soft text-critical-foreground",
    info: "bg-info-soft text-info-foreground",
  }[tone];
  return (
    <div className="surface flex items-center gap-4 px-4 py-3.5">
      <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${toneCls}`}>
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="figure text-xl font-semibold leading-tight tracking-tight">{value}</p>
      </div>
      <p className="ml-auto hidden text-right text-[11px] leading-tight text-muted-foreground 2xl:block">{hint}</p>
    </div>
  );
}
