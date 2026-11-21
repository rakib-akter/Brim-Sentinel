import type { Currency } from "@/lib/domain/types";

/** Reference "today" for the prototype so server and browser render the same dates. */
export const TODAY = "2026-11-21";

export function formatMoney(minor: number | null, currency: Currency = "CAD"): string {
  if (minor === null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export function formatDate(iso: string | null, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }).format(new Date(iso));
}

/** Whole days from TODAY to the given date (negative = overdue). */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso.slice(0, 10)) - Date.parse(TODAY);
  return Math.round(ms / 86_400_000);
}

export function dueLabel(iso: string | null): string {
  const d = daysUntil(iso);
  if (d === null) return "No due date";
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Due today";
  return `In ${d}d`;
}
