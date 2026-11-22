import { useDeferredValue, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Mail, Search, SearchX, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/sentinel/query-state";
import { EmptyState } from "@/components/sentinel/empty-state";
import { InvoiceTable } from "@/components/sentinel/invoice-table";
import { PageHeader } from "@/components/sentinel/page-header";
import { UploadInvoiceDialog } from "@/components/sentinel/upload-invoice-dialog";
import { invoicesQuery } from "@/lib/api/queries";
import { STATUS_FILTERS, STATUS_FILTER_LABELS, inGroup } from "@/lib/domain/status-groups";
import type { InvoiceStatusFilter } from "@/lib/domain/types";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface InboxSearch {
  q?: string | undefined;
  status?: InvoiceStatusFilter | undefined;
}

export const Route = createFileRoute("/invoices/")({
  validateSearch: (search: Record<string, unknown>): InboxSearch => {
    const out: InboxSearch = {};
    const q = search["q"];
    const status = search["status"];
    if (typeof q === "string" && q) out.q = q;
    if (typeof status === "string" && (STATUS_FILTERS as string[]).includes(status))
      out.status = status as InvoiceStatusFilter;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Invoice Inbox — Brim Sentinel" },
      {
        name: "description",
        content:
          "Every incoming invoice, credit note and supplier document, with its status and next action.",
      },
      { property: "og:title", content: "Invoice Inbox — Brim Sentinel" },
      {
        property: "og:description",
        content: "Bilingual invoice intake with processing, review and hold states.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ context, deps }) => {
    await context.queryClient.prefetchQuery(
      invoicesQuery(context.actor, deps.q ? { q: deps.q } : {}),
    );
  },
  component: InboxPage,
});

function InboxPage() {
  const { permissions } = useSession();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intake"
        title="Invoice Inbox"
        description="Review invoices from the AP mailbox and upload English or French documents."
        actions={permissions.includes("invoice.upload") ? <UploadInvoiceDialog /> : null}
      />
      <InboxContent />
    </div>
  );
}

function InboxContent() {
  const { user } = useSession();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/invoices/" });
  const status = search.status ?? "all";
  const [q, setQ] = useState(search.q ?? "");

  const pushed = useRef(search.q ?? "");

  // Pick up searches started elsewhere (e.g. the top bar).
  useEffect(() => {
    if ((search.q ?? "") !== pushed.current) {
      pushed.current = search.q ?? "";
      setQ(search.q ?? "");
    }
  }, [search.q]);

  // Keep the URL in sync with typing, lightly debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      if (pushed.current !== q) {
        pushed.current = q;
        void navigate({ search: (s) => ({ ...s, q: q || undefined }), replace: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, navigate]);

  const deferredQ = useDeferredValue(search.q);
  const all = useQuery({
    ...invoicesQuery(user.id, deferredQ ? { q: deferredQ } : {}),
    // Poll only while something is being read.
    refetchInterval: (query) =>
      query.state.data?.some((t) => t.invoice.status === "processing") ? 1500 : false,
  });

  const records = all.data ?? [];
  const tasks = records.filter((t) => inGroup(t.invoice.status, status));
  const counts = Object.fromEntries(
    STATUS_FILTERS.map((f) => [f, records.filter((t) => inGroup(t.invoice.status, f)).length]),
  ) as Record<InvoiceStatusFilter, number>;

  const fromEmail = records.filter((t) => t.invoice.channel === "email").length;
  const uploaded = records.length - fromEmail;

  return (
    <div className="space-y-4">
      {all.data && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Mail className="size-3.5" aria-hidden />{" "}
            <span className="figure font-medium text-foreground">{fromEmail}</span> from AP mailbox
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Upload className="size-3.5" aria-hidden />{" "}
            <span className="figure font-medium text-foreground">{uploaded}</span> uploaded
          </span>
        </div>
      )}

      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5">
          <nav aria-label="Filter by status" className="-mb-px flex flex-1 flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => {
              const active = f === status;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    void navigate({
                      search: (s) => ({ ...s, status: f === "all" ? undefined : f }),
                    })
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-focus",
                    active
                      ? "border-primary bg-primary-soft/50 text-primary"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {STATUS_FILTER_LABELS[f]}
                  <span
                    className={cn(
                      "figure text-xs",
                      active ? "text-accent-foreground/80" : "text-muted-foreground/80",
                    )}
                  >
                    {all.data && counts[f]}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Search by supplier or invoice number"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search supplier or invoice #"
              className="h-10 rounded-md pl-9 text-[13px]"
            />
          </div>
        </div>
        {all.error || all.isPending ? (
          <QueryState error={all.error} loading="Loading invoices…" retry={all.refetch} />
        ) : tasks.length ? (
          <InvoiceTable tasks={tasks} caption="Invoice inbox" />
        ) : search.q ? (
          <EmptyState
            icon={SearchX}
            title={`No results for “${search.q}”`}
            body="Check the spelling or search by invoice number instead."
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title={`Nothing in “${STATUS_FILTER_LABELS[status]}”`}
            body="New invoices from the AP mailbox or uploads will appear here."
          />
        )}
      </section>
    </div>
  );
}
