import { Link } from "@tanstack/react-router";
import { FileX2, Paperclip } from "lucide-react";
import type { InvoiceTask } from "@/lib/domain/types";
import { dueLabel, formatDate, daysUntil } from "@/lib/format";
import { ActionButton } from "./action-button";
import { LanguageBadge, RiskIndicator, StatusBadge } from "./badges";
import { Money } from "./money";

function IntakeFlag({ task }: { task: InvoiceTask }) {
  const codes = task.invoice.findings.map((f) => f.code);
  if (codes.includes("MISSING_ATTACHMENT"))
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-warning-foreground">
        <Paperclip className="size-3" aria-hidden /> No attachment
      </span>
    );
  if (codes.includes("EXTRACTION_UNREADABLE"))
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-warning-foreground">
        <FileX2 className="size-3" aria-hidden /> Fields unreadable
      </span>
    );
  return null;
}

export function InvoiceTable({ tasks, caption }: { tasks: InvoiceTask[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="px-5 py-2.5 font-medium">Supplier</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Invoice</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Due</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Priority</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">
              <span className="sr-only">Next action</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tasks.map((task) => {
            const inv = task.invoice;
            const days = daysUntil(inv.dueDate);
            const urgent = days !== null && days <= 3 && !["settled", "credit_recorded", "released"].includes(inv.status);
            return (
              <tr key={inv.id} className="transition-colors hover:bg-secondary/50">
                <td className="max-w-[280px] px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Link
                      to="/invoices/$invoiceId"
                      params={{ invoiceId: inv.id }}
                      className="truncate font-medium text-foreground hover:underline"
                    >
                      {inv.supplierName}
                    </Link>
                    <LanguageBadge language={inv.language} scanned={inv.scanned} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-xs text-muted-foreground">{task.plainStatus}</span>
                  </div>
                  {inv.status === "processing" ? (
                    <div className="processing-bar mt-2 h-1 w-40 rounded-full bg-primary-soft" role="progressbar" aria-label="Reading document" />
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <div className="figure text-foreground">{inv.number ?? <span className="text-muted-foreground">Unreadable</span>}</div>
                  <div className="figure whitespace-nowrap text-[11px] text-muted-foreground">{inv.id}</div>
                  <IntakeFlag task={task} />
                </td>
                <td className="px-3 py-3 text-right">
                  <Money minor={inv.totalMinor} currency={inv.currency} className="font-medium" />
                </td>
                <td className="px-3 py-3">
                  <div className="figure">{formatDate(inv.dueDate)}</div>
                  {inv.dueDate ? (
                    <div className={`whitespace-nowrap text-[11px] ${urgent ? "font-medium text-warning-foreground" : "text-muted-foreground"}`}>
                      {dueLabel(inv.dueDate)}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <RiskIndicator risk={inv.risk} />
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={inv.status} />
                </td>
                <td className="px-5 py-3 text-right">
                  <ActionButton task={task} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
