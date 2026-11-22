import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileText, Maximize2 } from "lucide-react";
import { api } from "@/lib/api/client";
import type { DocumentLayoutOut } from "@/lib/api/schema";
import { useDocumentFocus } from "@/lib/document-focus";
import { useSession } from "@/lib/session";
import { DocumentPanel } from "./invoice-workspace";
import { usePageImage } from "./source-review";

const LABEL: Record<string, string> = {
  vendor_name: "Supplier",
  invoice_number: "Invoice number",
  invoice_date: "Invoice date",
  due_date: "Due date",
  po_number: "Purchase order",
  subtotal: "Subtotal",
  total: "Total",
  remit: "Payment details",
};
export const anchorLabel = (k: string) =>
  LABEL[k] ?? (k.startsWith("line:") ? `Line ${k.slice(5)}` : k.startsWith("tax:") ? "Tax" : k);

export function useDocumentLayout(invoiceId: string, version: number, enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: ["invoice-layout", user.id, invoiceId, version],
    queryFn: () => api.documentLayout(user.id, invoiceId),
    enabled,
    retry: false,
  });
}

/**
 * The original invoice, kept beside the review. Evidence elsewhere on the page can ask it to
 * highlight the region a value was read from; that only happens when coordinates exist.
 */
export function DocumentPane({
  invoiceId,
  layout,
  fileName,
  scanned,
  onOpenSource,
}: {
  invoiceId: string;
  layout: DocumentLayoutOut | undefined;
  fileName: string | null;
  scanned: boolean;
  onOpenSource: () => void;
}) {
  const { user } = useSession();
  const focus = useDocumentFocus();
  const pages = layout?.pages ?? [];
  const usable = !!layout && layout.source !== "none" && pages.length > 0;
  const [page, setPage] = useState(1);
  const active = focus?.focusKey ?? null;
  const anchor = useMemo(() => layout?.anchors.find((a) => a.key === active), [layout, active]);
  useEffect(() => {
    if (anchor && anchor.page !== page) setPage(anchor.page);
  }, [anchor, page]);
  const { src } = usePageImage(user.id, invoiceId, page, usable);
  const scroller = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = scroller.current;
    const b = boxRef.current;
    if (!c || !b) return;
    const cr = c.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    c.scrollBy({ top: br.top - cr.top - cr.height / 3, behavior: "smooth" });
  }, [anchor, src]);

  if (!usable) {
    return (
      <div className="space-y-2">
        <DocumentPanel invoiceId={invoiceId} fileName={fileName} scanned={scanned} />
        {active && (
          <p className="px-1 text-xs text-muted-foreground" role="status">
            Region highlighting isn't available for this document, so look for “
            {anchorLabel(active)}” on the page.
          </p>
        )}
      </div>
    );
  }
  const size = pages[page - 1];
  return (
    <section className="surface flex flex-col overflow-hidden" aria-label="Original invoice">
      <div className="flex items-center gap-1 border-b px-3 py-2 text-xs">
        <FileText className="size-4 text-muted-foreground" aria-hidden />
        <span className="mr-auto truncate font-medium">{fileName ?? "Original document"}</span>
        {pages.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded p-1 hover:bg-secondary disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="figure tabular-nums">
              {page}/{pages.length}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= pages.length}
              onClick={() => setPage((p) => p + 1)}
              className="rounded p-1 hover:bg-secondary disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onOpenSource}
          className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-primary-soft"
        >
          <Maximize2 className="size-3.5" aria-hidden /> Source view
        </button>
      </div>
      <div ref={scroller} className="max-h-[calc(100vh-15rem)] overflow-auto bg-muted/40 p-3">
        {size && (
          <div
            className="relative mx-auto w-full bg-white shadow-card"
            style={{ aspectRatio: `${size.width} / ${size.height}` }}
          >
            {src ? (
              <img
                src={src}
                alt={`Page ${page} of the original invoice`}
                className="fade-in absolute inset-0 size-full select-none"
                draggable={false}
              />
            ) : (
              <div className="absolute inset-0 animate-pulse bg-muted" />
            )}
            {anchor && anchor.page === page && (
              <div
                ref={boxRef}
                key={anchor.key}
                className="box-ping absolute rounded-[3px] border-2 border-primary bg-primary/10"
                style={{
                  left: `${((anchor.box[0] ?? 0) / size.width) * 100 - 0.5}%`,
                  top: `${((anchor.box[1] ?? 0) / size.height) * 100 - 0.4}%`,
                  width: `${(((anchor.box[2] ?? 0) - (anchor.box[0] ?? 0)) / size.width) * 100 + 1}%`,
                  height: `${(((anchor.box[3] ?? 0) - (anchor.box[1] ?? 0)) / size.height) * 100 + 0.8}%`,
                }}
                aria-hidden
              />
            )}
          </div>
        )}
      </div>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground" role="status">
        {anchor
          ? `Highlighted: ${anchorLabel(anchor.key)} · page ${anchor.page}`
          : active
            ? `“${anchorLabel(active)}” has no recorded position on the page.`
            : "Use “Show on document” on any evidence to highlight where it was read."}
      </p>
    </section>
  );
}
