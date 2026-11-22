import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * One evidence drawer pattern for the whole app: source, date, actor, record ID, the relevant
 * fields, and a direct link where the viewer may open the record. When a source is unavailable the
 * drawer says so rather than leaving a gap.
 */
export interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: string;
  title: string;
  description?: string | undefined;
  /** Label/value facts. Empty values are omitted. */
  facts?: Array<[string, string | null | undefined]>;
  link?: { to: "invoice"; invoiceId: string } | { to: "vendor"; vendorId: string } | undefined;
  children?: ReactNode;
}

export function EvidenceDrawer({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  facts = [],
  link,
  children,
}: EvidenceDrawerProps) {
  const shown = facts.filter(([, v]) => v != null && v !== "");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <p className="eyebrow">{eyebrow}</p>
          <SheetTitle className="text-lg leading-snug">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {shown.length > 0 && (
            <dl className="divide-y rounded-lg border">
              {shown.map(([k, v], i) => (
                <div
                  key={`${k}-${i}`}
                  className="grid grid-cols-[8rem_1fr] gap-3 px-3 py-2 text-sm"
                >
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {children}
          {link?.to === "invoice" && (
            <Link
              to="/invoices/$invoiceId"
              params={{ invoiceId: link.invoiceId }}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              Open invoice {link.invoiceId}
            </Link>
          )}
          {link?.to === "vendor" && (
            <Link
              to="/vendors"
              search={{ vendorId: link.vendorId, q: "", status: "" }}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              Open supplier profile
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Shown in place of evidence that the API did not return. */
export function EvidenceUnavailable({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      {what} isn't available from the records Sentinel returned for your role.
    </p>
  );
}
