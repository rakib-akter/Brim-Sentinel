/**
 * Today's date (UTC, YYYY-MM-DD) from the real clock. The backend dates its checks the same way
 * (the later of its configured as-of date and the real date), so due labels and "as of" agree.
 * Day precision keeps server and browser renders identical except across midnight UTC.
 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatMoney(minor: number | null, currency = "CAD"): string {
  if (minor === null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export function formatDate(
  iso: string | null,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }).format(new Date(iso));
}

/** Whole days from today() to the given date (negative = overdue). */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso.slice(0, 10)) - Date.parse(today());
  return Math.round(ms / 86_400_000);
}

export function dueLabel(iso: string | null): string {
  const d = daysUntil(iso);
  if (d === null) return "No due date";
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Due today";
  return `In ${d}d`;
}
