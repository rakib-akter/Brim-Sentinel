import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvoiceTask } from "@/lib/domain/types";

/** The single, obvious next action for an invoice task. */
export function ActionButton({
  task,
  size = "sm",
}: {
  task: InvoiceTask;
  size?: "sm" | "default";
}) {
  const { action, invoice } = task;
  const variant =
    action.emphasis === "primary"
      ? "default"
      : action.emphasis === "secondary"
        ? "outline"
        : "ghost";
  if (action.disabled) {
    return (
      <Button size={size} variant="ghost" disabled className="max-w-[18rem]" title={action.label}>
        <span className="truncate">{action.label}</span>
      </Button>
    );
  }
  return (
    <Button size={size} variant={variant} asChild className="max-w-[18rem] shrink-0">
      <Link to="/invoices/$invoiceId" params={{ invoiceId: invoice.id }} title={action.label}>
        <span className="truncate">{action.label}</span>
        {action.emphasis === "primary" ? <ArrowRight aria-hidden /> : null}
      </Link>
    </Button>
  );
}
