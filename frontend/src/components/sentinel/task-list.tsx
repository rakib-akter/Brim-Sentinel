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
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id={`${title}-heading`}
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
          >
            {title}
            <span className="figure rounded-full bg-secondary px-2 py-px text-xs font-medium text-muted-foreground">
              {count}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      {footer ? <div className="border-t px-5 py-2.5">{footer}</div> : null}
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
        className="truncate text-sm font-medium text-foreground hover:underline"
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
      className={`mt-0.5 truncate text-[13px] ${STATUS_TEXT[inv.status] ?? "text-muted-foreground"}`}
    >
      {task.plainStatus}
    </p>
  );

  if (compact) {
    return (
      <li className="relative px-5 py-3.5 transition-colors hover:bg-secondary/60">
        <span
          className={`absolute inset-y-3 left-0 w-[3px] rounded-r ${inv.risk ? RAIL[inv.risk] : "bg-border"}`}
          aria-hidden
        />
        <div className="flex items-baseline justify-between gap-3">
          {title}
          <Money
            minor={inv.totalMinor}
            currency={inv.currency}
            className="shrink-0 text-sm font-medium"
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
    <li className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-secondary/60">
      <span
        className={`absolute inset-y-3 left-0 w-[3px] rounded-r ${inv.risk ? RAIL[inv.risk] : "bg-border"}`}
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
          className="whitespace-nowrap text-sm font-medium"
        />
        <ActionButton task={task} />
      </div>
    </li>
  );
}
