import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { InvoiceStatus, InvoiceTask } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";
import { ActionButton } from "./action-button";
import { Money } from "./money";

const STATUS_TEXT: Partial<Record<InvoiceStatus, string>> = {
  on_hold: "text-critical-foreground",
  needs_review: "text-warning-foreground",
  pending_approval: "text-accent-foreground",
};

const RAIL: Record<string, string> = {
  high: "bg-critical",
  medium: "bg-warning",
  low: "bg-border-strong",
};

export function TaskSection({
  title,
  description,
  icon: Icon,
  count,
  children,
  footer,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  count: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="surface flex flex-col overflow-hidden" aria-labelledby={`${title}-heading`}>
      <header className="flex items-center gap-3 border-b border-border/80 px-5 py-[18px] md:px-6">
        <div className="grid size-7 shrink-0 place-items-center text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id={`${title}-heading`}
            className="flex items-center gap-2.5 text-[14px] font-semibold tracking-[-0.018em]"
          >
            {title}
            <span className="figure rounded-md border border-border bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {count}
            </span>
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      {footer ? <div className="border-t border-border/80 px-5 py-3 md:px-6">{footer}</div> : null}
    </section>
  );
}

export function TaskRow({
  task,
  dateLabel,
  compact = false,
}: {
  task: InvoiceTask;
  dateLabel?: "due" | "scheduled";
  compact?: boolean;
}) {
  const inv = task.invoice;
  const date = dateLabel === "scheduled" ? (inv.scheduledFor ?? null) : inv.dueDate;
  const meta = `Owner: ${task.owner}${date ? ` · ${dateLabel === "scheduled" ? "Pays" : "Due"} ${formatDate(date)}` : ""}`;
  const title = (
    <div className="flex min-w-0 items-baseline gap-2">
      <Link
        to="/invoices/$invoiceId"
        params={{ invoiceId: inv.id }}
        className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground underline-offset-4 hover:text-primary hover:underline"
      >
        {inv.supplierName}
      </Link>
      <span className="figure shrink-0 text-xs text-muted-foreground">
        {inv.number ? `#${inv.number}` : inv.id}
      </span>
    </div>
  );
  const status = (
    <p
      className={`mt-0.5 line-clamp-2 text-[12px] leading-relaxed ${STATUS_TEXT[inv.status] ?? "text-muted-foreground"}`}
    >
      {task.plainStatus}
    </p>
  );

  if (compact) {
    return (
      <li className="relative px-5 py-3.5 transition-colors hover:bg-secondary/35">
        <span
          className={`absolute inset-y-4 left-0 w-[2px] rounded-r ${inv.risk ? RAIL[inv.risk] : "bg-border"}`}
          aria-hidden
        />
        <div className="flex items-baseline justify-between gap-3">
          {title}
          <Money
            minor={inv.totalMinor}
            currency={inv.currency}
            className="figure shrink-0 text-[13px] font-semibold tracking-tight"
          />
        </div>
        {status}
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[11px] text-muted-foreground">{meta}</p>
          <ActionButton task={task} />
        </div>
      </li>
    );
  }

  return (
    <li className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-secondary/35">
      <span
        className={`absolute inset-y-4 left-0 w-[2px] rounded-r ${inv.risk ? RAIL[inv.risk] : "bg-border"}`}
        aria-hidden
      />
      <div className="min-w-[14rem] flex-1">
        {title}
        {status}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta}</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-4">
        <Money
          minor={inv.totalMinor}
          currency={inv.currency}
          className="figure whitespace-nowrap text-[13px] font-semibold tracking-tight"
        />
        <ActionButton task={task} />
      </div>
    </li>
  );
}
