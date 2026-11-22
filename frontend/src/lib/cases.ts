import type { CaseSummary } from "@/lib/api/schema";

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const SEVERITY_STYLE: Record<string, { rail: string; chip: string; label: string }> = {
  critical: {
    rail: "bg-critical",
    chip: "bg-critical-soft text-critical-foreground",
    label: "Critical",
  },
  high: {
    rail: "bg-critical/70",
    chip: "bg-critical-soft text-critical-foreground",
    label: "High",
  },
  medium: { rail: "bg-warning", chip: "bg-warning-soft text-warning-foreground", label: "Medium" },
  low: { rail: "bg-border-strong", chip: "bg-secondary text-muted-foreground", label: "Low" },
};

/** Most severe first, then oldest first, so the case that has waited longest rises within a band. */
export function sortCases<T extends Pick<CaseSummary, "severity" | "created_at">>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.created_at.localeCompare(b.created_at),
  );
}
