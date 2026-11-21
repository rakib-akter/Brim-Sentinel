import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvoiceTask } from "@/lib/domain/types";

/** The single, obvious next action for an invoice task. */
export function ActionButton({ task, size = "sm" }: { task: InvoiceTask; size?: "sm" | "default" }) {
  const { action, invoice } = task;
  const variant = action.emphasis === "primary" ? "default" : action.emphasis === "secondary" ? "outline" : "ghost";
  if (action.disabled) {
    return (
      <Button size={size} variant="ghost" disabled>
        {action.label}
      </Button>
    );
  }
  return (
    <Button size={size} variant={variant} asChild>
      <Link to="/invoices/$invoiceId" params={{ invoiceId: invoice.id }}>
        {action.label}
        {action.emphasis === "primary" ? <ArrowRight aria-hidden /> : null}
      </Link>
    </Button>
  );
}
