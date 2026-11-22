import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  Play,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import type { InvoiceDetail as InvoiceRecord, LayoutAnchorOut } from "@/lib/api/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";
import { DocumentPanel } from "./invoice-workspace";
import { downloadFile } from "./workflow-form";

/**
 * Source-grounded review: the original page on the left, what Sentinel read on the right, and a
 * line drawn from each value to the exact place it was read. On arrival it walks through the
 * values that decide a payment (supplier, number, dates, total, bank details) so a reviewer can
 * see at a glance that every figure comes from the document.
 */

interface FieldRow {
  key: string;
  label: string;
  value: string;
  detail?: string;
  strong?: boolean;
  /** Field names that, when listed as uncertain, mean a person must confirm this value. */
  uncertain: string[];
}

interface Group {
  title: string;
  rows: FieldRow[];
}

const TOUR = ["vendor_name", "invoice_number", "invoice_date", "due_date", "total", "remit"];
const TOUR_STEP_MS = 1700;
const longDate = (iso: string | null) =>
  iso ? formatDate(iso, { year: "numeric", month: "short", day: "numeric" }) : "";

function buildGroups(record: InvoiceRecord): Group[] {
  const ef = record.extracted_fields;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const money = (minor: unknown) =>
    typeof minor === "number" ? formatMoney(minor, record.currency ?? "CAD") : "";
  const details: FieldRow[] = [
    {
      key: "vendor_name",
      label: "Supplier",
      value: text(ef["vendor_name"]) || (record.vendor_name ?? ""),
      uncertain: ["vendor_name", "vendor"],
    },
    {
      key: "invoice_number",
      label: "Invoice number",
      value: text(ef["invoice_number"]) || (record.invoice_number ?? ""),
      uncertain: ["invoice_number"],
    },
    {
      key: "invoice_date",
      label: "Invoice date",
      value: longDate(record.invoice_date),
      uncertain: ["invoice_date"],
    },
    {
      key: "due_date",
      label: "Due date",
      value: longDate(record.due_date),
      uncertain: ["due_date"],
    },
  ];
  if (text(ef["po_number"]))
    details.push({
      key: "po_number",
      label: "Purchase order",
      value: text(ef["po_number"]),
      uncertain: ["po_number"],
    });
  const lines: FieldRow[] = record.line_items.map((line) => ({
    key: `line:${line.line_no}`,
    label: line.description,
    value: money(line.amount_minor),
    detail:
      line.unit_price_minor === null
        ? `Qty ${line.quantity}`
        : `${line.quantity} × ${money(line.unit_price_minor)}`,
    uncertain: ["lines", `lines[${line.line_no}].description`],
  }));
  const totals: FieldRow[] = [
    {
      key: "subtotal",
      label: "Subtotal",
      value: money(record.subtotal_minor),
      uncertain: ["subtotal"],
    },
    ...record.taxes.map((tax, i) => ({
      key: `tax:${i}`,
      label: String(tax["label"] ?? "Tax"),
      value: money(tax["amount_minor"]),
      uncertain: [`tax[${String(tax["label"] ?? "")}]`],
    })),
    {
      key: "total",
      label: "Total due",
      value: money(record.amount_minor),
      strong: true,
      uncertain: ["total", "currency"],
    },
  ];
  const groups: Group[] = [
    { title: "Invoice", rows: details },
    { title: `Line items (${lines.length})`, rows: lines },
    { title: "Totals", rows: totals },
  ];
  const method = text(record.remit["method"]);
  if (method)
    groups.push({
      title: "Payment details",
      rows: [
        {
          key: "remit",
          label: method === "EFT" ? "Bank account" : method,
          value: text(record.remit["account_masked"]) || method,
          uncertain: ["remit"],
        },
      ],
    });
  return groups.filter((g) => g.rows.length);
}

type Status = "check" | "exact" | "ocr-high" | "ocr-low" | "missing";

function statusOf(row: FieldRow, anchor: LayoutAnchorOut | undefined, uncertain: Set<string>) {
  if (!row.value || row.uncertain.some((k) => uncertain.has(k))) return "check" as const;
  if (!anchor) return "missing" as const;
  if (anchor.confidence === null) return "exact" as const;
  return anchor.confidence >= 0.9 ? ("ocr-high" as const) : ("ocr-low" as const);
}

function StatusChip({ status, confidence }: { status: Status; confidence: number | null }) {
  const pct = confidence === null ? "" : `${Math.round(confidence * 100)}%`;
  const map: Record<Status, { cls: string; text: string; title: string }> = {
    check: {
      cls: "bg-warning-soft text-warning-foreground",
      text: "Check",
      title: "Missing or unclear on the document. A person must confirm it.",
    },
    exact: {
      cls: "bg-success-soft text-success-foreground",
      text: "Exact",
      title: "Read character for character from the PDF's text.",
    },
    "ocr-high": {
      cls: "bg-success-soft text-success-foreground",
      text: pct,
      title: "How sure the scan reader was about this value.",
    },
    "ocr-low": {
      cls: "bg-warning-soft text-warning-foreground",
      text: pct,
      title: "The scan reader was less sure. Worth a look.",
    },
    missing: {
      cls: "bg-secondary text-muted-foreground",
      text: "Not boxed",
      title: "The value was read, but its exact spot on the page could not be pinned down.",
    },
  };
  const m = map[status];
  return (
    <span className="flex items-center gap-1.5" title={m.title}>
      <span className={`figure rounded-full px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>
        {m.text}
      </span>
      {status === "check" || status === "ocr-low" ? (
        <AlertTriangle className="size-4 text-warning" aria-hidden />
      ) : status === "missing" ? (
        <span className="size-4" />
      ) : (
        <CheckCircle2 className="size-4 text-success" aria-hidden />
      )}
    </span>
  );
}

export function usePageImage(actor: string, invoiceId: string, page: number, enabled: boolean) {
  const image = useQuery({
    queryKey: ["invoice-page", actor, invoiceId, page],
    queryFn: () => api.documentPage(actor, invoiceId, page),
    enabled,
    staleTime: 5 * 60_000,
  });
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!image.data) return;
    const url = URL.createObjectURL(image.data);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [image.data]);
  return { src, error: image.error };
}

export function SourceReview({
  invoiceId,
  record,
  fileName,
  scanned,
  focusKey = null,
}: {
  invoiceId: string;
  record: InvoiceRecord;
  fileName: string | null;
  scanned: boolean;
  /** A region another part of the page asked to show (e.g. "Show on document" on a finding). */
  focusKey?: string | null;
}) {
  const { user } = useSession();
  const layout = useQuery({
    queryKey: ["invoice-layout", user.id, invoiceId, record.version],
    queryFn: () => api.documentLayout(user.id, invoiceId),
    enabled: !!fileName,
    retry: false,
  });
  const groups = useMemo(() => buildGroups(record), [record]);
  const uncertain = useMemo(() => new Set(record.uncertain_fields), [record.uncertain_fields]);
  const anchors = useMemo(() => {
    const m = new Map<string, LayoutAnchorOut>();
    for (const a of layout.data?.anchors ?? []) m.set(a.key, a);
    return m;
  }, [layout.data]);
  const pages = layout.data?.pages ?? [];
  const usable = !!layout.data && layout.data.source !== "none" && pages.length > 0;

  const [active, setActive] = useState<string | null>(null);
  const [touring, setTouring] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [line, setLine] = useState<{
    d: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const boxRefs = useRef(new Map<string, HTMLElement>());
  const { src, error: pageError } = usePageImage(user.id, invoiceId, page, usable);

  useEffect(() => {
    const a = focusKey ? anchors.get(focusKey) : undefined;
    if (!a || !focusKey) return;
    setActive(focusKey);
    if (typeof a.page === "number") setPage(a.page);
  }, [focusKey, anchors]);

  const tourKeys = useMemo(() => TOUR.filter((k) => anchors.has(k)), [anchors]);
  const started = useRef(false);
  useEffect(() => {
    if (!usable || started.current || !tourKeys.length) return;
    started.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) setActive(anchors.has("total") ? "total" : (tourKeys[0] ?? null));
    else setTouring(true);
  }, [usable, tourKeys, anchors]);

  useEffect(() => {
    if (!touring) return;
    let i = 0;
    setActive(tourKeys[0] ?? null);
    const id = setInterval(() => {
      i += 1;
      if (i >= tourKeys.length) {
        clearInterval(id);
        setTouring(false);
        return;
      }
      setActive(tourKeys[i] ?? null);
    }, TOUR_STEP_MS);
    return () => clearInterval(id);
  }, [touring, tourKeys]);

  const focus = (key: string) => {
    setTouring(false);
    setActive(key);
  };

  // Show the page the active value is on.
  const activeAnchor = active ? anchors.get(active) : undefined;
  useEffect(() => {
    if (activeAnchor && activeAnchor.page !== page) setPage(activeAnchor.page);
  }, [activeAnchor, page]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const doc = docRef.current;
    const row = active ? rowRefs.current.get(active) : undefined;
    const box = active ? boxRefs.current.get(active) : undefined;
    if (!root || !doc || !row || !box) return setLine(null);
    const r = root.getBoundingClientRect();
    const a = box.getBoundingClientRect();
    const b = row.getBoundingClientRect();
    const d = doc.getBoundingClientRect();
    const l = listRef.current?.getBoundingClientRect();
    const boxSeen = a.bottom > d.top && a.top < d.bottom && a.left < d.right;
    const rowSeen = !l || (b.bottom > l.top && b.top < l.bottom);
    if (!boxSeen || !rowSeen || b.left < Math.min(a.right, d.right)) return setLine(null);
    const x1 = Math.min(a.right, d.right) - r.left + 1;
    const y1 = a.top + a.height / 2 - r.top;
    const x2 = b.left - r.left + 2;
    const y2 = b.top + b.height / 2 - r.top;
    const gutter = d.right - r.left;
    const mx = Math.max(x1 + 10, gutter + (x2 - gutter) / 2);
    const bend = Math.min(8, Math.abs(y2 - y1) / 2);
    const dir = y2 > y1 ? 1 : -1;
    const path =
      Math.abs(y2 - y1) < 2
        ? `M ${x1} ${y1} H ${x2}`
        : `M ${x1} ${y1} H ${mx - bend} Q ${mx} ${y1} ${mx} ${y1 + dir * bend} V ${y2 - dir * bend} Q ${mx} ${y2} ${mx + bend} ${y2} H ${x2}`;
    setLine({ d: path, x1, y1, x2, y2 });
  }, [active]);

  // Bring the active value into view on both sides (without moving the whole page).
  useLayoutEffect(() => {
    if (!active) return;
    const reveal = (container: HTMLElement | null, el: HTMLElement | undefined) => {
      if (!container || !el) return;
      const c = container.getBoundingClientRect();
      const e = el.getBoundingClientRect();
      if (e.top < c.top + 24 || e.bottom > c.bottom - 24)
        container.scrollBy({ top: e.top - c.top - c.height / 3, behavior: "smooth" });
    };
    reveal(docRef.current, boxRefs.current.get(active));
    reveal(listRef.current, rowRefs.current.get(active));
    measure();
  }, [active, page, src, zoom, measure]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const targets = [docRef.current, listRef.current, window];
    for (const t of targets) t?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => {
      cancelAnimationFrame(frame);
      for (const t of targets) t?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [measure]);

  const located = groups.flatMap((g) => g.rows).filter((r) => anchors.has(r.key)).length;
  const total = groups.flatMap((g) => g.rows).length;
  const size = pages[page - 1];
  const onPage = (layout.data?.anchors ?? []).filter((a) => a.page === page);
  const keyOf = useMemo(() => {
    const m = new Map<string, FieldRow>();
    for (const g of groups) for (const r of g.rows) m.set(r.key, r);
    return m;
  }, [groups]);

  return (
    <section className="surface rise-in overflow-hidden" aria-labelledby="source-heading">
      <div
        ref={rootRef}
        className="relative grid gap-4 p-4 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)] lg:gap-10"
      >
        {/* Original document */}
        {usable && size ? (
          <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-muted/40">
            <div className="flex items-center gap-1 bg-zinc-900 px-3 py-2 text-xs text-zinc-100">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="figure tabular-nums">
                {page} / {pages.length}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= pages.length}
                onClick={() => setPage((p) => p + 1)}
                className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
              <span className="mx-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Zoom out"
                  disabled={zoom <= 0.5}
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
                >
                  <Minus className="size-4" />
                </button>
                <span className="figure w-11 text-center tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  disabled={zoom >= 2}
                  onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
                  className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
                >
                  <Plus className="size-4" />
                </button>
              </span>
              {fileName ? (
                <button
                  type="button"
                  aria-label="Download original"
                  title="Download original"
                  onClick={async () =>
                    downloadFile(await api.document(user.id, invoiceId), fileName)
                  }
                  className="rounded p-1 hover:bg-white/10"
                >
                  <Download className="size-4" />
                </button>
              ) : null}
            </div>
            <div ref={docRef} className="h-[min(74vh,720px)] overflow-auto p-4">
              <div
                className="relative mx-auto bg-white shadow-card transition-[width] duration-300"
                style={{ width: `${zoom * 100}%`, aspectRatio: `${size.width} / ${size.height}` }}
              >
                {src ? (
                  <img
                    src={src}
                    alt={`Page ${page} of the original invoice`}
                    className="fade-in absolute inset-0 size-full select-none"
                    onLoad={measure}
                    draggable={false}
                  />
                ) : pageError ? (
                  <p role="alert" className="p-6 text-sm">
                    {pageError.message}
                  </p>
                ) : (
                  <div className="absolute inset-0 animate-pulse bg-muted" />
                )}
                {onPage.map((a) => {
                  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = a.box;
                  const pad = size.width * 0.005;
                  const isActive = a.key === active;
                  const row = keyOf.get(a.key);
                  const warn = row ? statusOf(row, a, uncertain) === "check" : false;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      ref={(el) => {
                        if (el) boxRefs.current.set(a.key, el);
                        else boxRefs.current.delete(a.key);
                      }}
                      aria-label={`Show ${row?.label ?? a.key}`}
                      onMouseEnter={() => focus(a.key)}
                      onFocus={() => focus(a.key)}
                      onClick={() => focus(a.key)}
                      className={`absolute rounded-[3px] transition-all duration-300 ${
                        isActive
                          ? `box-ping border-2 ${warn ? "border-warning bg-warning/15" : "border-primary bg-primary/10"}`
                          : "border border-primary/25 bg-primary/[0.04] hover:border-primary/60 hover:bg-primary/10"
                      }`}
                      style={{
                        left: `${((x0 - pad) / size.width) * 100}%`,
                        top: `${((y0 - pad) / size.height) * 100}%`,
                        width: `${((x1 - x0 + 2 * pad) / size.width) * 100}%`,
                        height: `${((y1 - y0 + 2 * pad) / size.height) * 100}%`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            {layout.isPending && fileName ? (
              <div className="h-[min(74vh,720px)] animate-pulse rounded-xl bg-muted" />
            ) : (
              <DocumentPanel invoiceId={invoiceId} fileName={fileName} scanned={scanned} />
            )}
          </div>
        )}

        {/* What Sentinel read */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 id="source-heading" className="text-sm font-semibold">
              What Sentinel read
            </h2>
            {usable ? (
              <span className="figure rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-medium text-success-foreground">
                {located} of {total} found on the page
              </span>
            ) : null}
          </div>
          <div ref={listRef} className="h-[min(74vh,720px)] overflow-auto">
            {groups.map((g) => (
              <div key={g.title}>
                <p className="sticky top-0 z-10 border-b bg-muted/80 px-4 py-1.5 text-xs font-semibold backdrop-blur">
                  {g.title}
                </p>
                <ul className="divide-y">
                  {g.rows.map((row) => {
                    const anchor = anchors.get(row.key);
                    const status = statusOf(row, anchor, uncertain);
                    const isActive = row.key === active;
                    return (
                      <li
                        key={row.key}
                        ref={(el) => {
                          if (el) rowRefs.current.set(row.key, el);
                          else rowRefs.current.delete(row.key);
                        }}
                        tabIndex={anchor ? 0 : -1}
                        onMouseEnter={() => anchor && focus(row.key)}
                        onFocus={() => anchor && focus(row.key)}
                        onClick={() => anchor && focus(row.key)}
                        className={`flex items-center gap-3 px-4 py-2.5 transition-colors duration-200 ${
                          anchor ? "cursor-pointer" : ""
                        } ${isActive ? "bg-primary-soft/60 shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-secondary/60"}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-muted-foreground">{row.label}</p>
                          {row.detail ? (
                            <p className="figure text-[11px] text-muted-foreground">{row.detail}</p>
                          ) : null}
                        </div>
                        <p
                          className={`figure text-right text-sm ${row.strong ? "text-base font-semibold text-primary" : ""}`}
                        >
                          {row.value || (
                            <span className="text-warning-foreground">Needs a person</span>
                          )}
                        </p>
                        <StatusChip status={status} confidence={anchor?.confidence ?? null} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* The line from the value to where it was read */}
        {line ? (
          <svg
            className="pointer-events-none absolute inset-0 hidden size-full overflow-visible lg:block"
            aria-hidden
          >
            <path
              key={active ?? ""}
              d={line.d}
              pathLength={1}
              className="draw-line"
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={1.75}
              strokeLinecap="round"
            />
            <circle cx={line.x1} cy={line.y1} r={3} fill="var(--color-primary)" />
            <circle
              key={`end-${active ?? ""}`}
              cx={line.x2}
              cy={line.y2}
              r={3.5}
              fill="var(--color-primary)"
              className="fade-in"
              style={{ animationDelay: "420ms" }}
            />
          </svg>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t bg-primary-soft/30 px-5 py-3">
        <ShieldCheck className="size-6 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Source-grounded review</p>
          <p className="text-xs text-muted-foreground">
            Every value points back to where it was read on the original. Hover a value to see it on
            the page.
          </p>
        </div>
        {usable && tourKeys.length ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTouring(false);
              requestAnimationFrame(() => setTouring(true));
            }}
          >
            <Play aria-hidden /> {touring ? "Touring…" : "Replay tour"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
