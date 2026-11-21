import { AlertTriangle, Ban, CheckCircle2, CircleDot, Clock, Loader2, PauseCircle, ScanLine, Send } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { DocLanguage, InvoiceStatus, RiskBand } from "@/lib/domain/types";

type Variant = NonNullable<BadgeProps["variant"]>;

const STATUS: Record<InvoiceStatus, { label: string; variant: Variant; icon: typeof Clock }> = {
  processing: { label: "Processing", variant: "info", icon: Loader2 },
  needs_review: { label: "Needs review", variant: "warning", icon: AlertTriangle },
  on_hold: { label: "Payment paused", variant: "critical", icon: PauseCircle },
  pending_approval: { label: "Awaiting approval", variant: "violet", icon: Clock },
  approved: { label: "Approved", variant: "success", icon: CheckCircle2 },
  scheduled: { label: "Scheduled · Simulated", variant: "info", icon: Send },
  released: { label: "Released · Simulated", variant: "success", icon: Send },
  settled: { label: "Settled · Simulated", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed · Simulated", variant: "critical", icon: Ban },
  rejected: { label: "Rejected", variant: "neutral", icon: Ban },
  credit_recorded: { label: "Credit note", variant: "neutral", icon: CircleDot },
  non_payable: { label: "Not payable", variant: "neutral", icon: CircleDot },
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant}>
      <Icon className={status === "processing" ? "animate-spin" : undefined} aria-hidden />
      {s.label}
    </Badge>
  );
}

const RISK: Record<RiskBand, { label: string; dot: string; text: string }> = {
  high: { label: "High", dot: "bg-critical", text: "text-critical-foreground" },
  medium: { label: "Medium", dot: "bg-warning", text: "text-warning-foreground" },
  low: { label: "Low", dot: "bg-success", text: "text-success-foreground" },
};

/** Review priority — advisory only, never a fraud probability or an approval. */
export function RiskIndicator({ risk }: { risk: RiskBand }) {
  const r = RISK[risk];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${r.text}`} title="Review priority (advisory)">
      <span className={`size-2 rounded-full ${r.dot}`} aria-hidden />
      {r.label}
    </span>
  );
}

export function LanguageBadge({ language, scanned }: { language: DocLanguage; scanned?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="rounded border border-border px-1 py-px font-mono text-[10px] font-semibold uppercase leading-none text-muted-foreground"
        title={language === "fr" ? "French document" : "English document"}
      >
        {language}
      </span>
      {scanned ? (
        <span title="Scanned image" className="text-muted-foreground">
          <ScanLine className="size-3.5" aria-label="Scanned image" />
        </span>
      ) : null}
    </span>
  );
}

export function SimulatedTag() {
  return (
    <span className="rounded border border-dashed border-border-strong px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      Simulated
    </span>
  );
}
