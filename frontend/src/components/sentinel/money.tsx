import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({
  minor,
  currency,
  className,
  showCode = true,
}: {
  minor: number | null;
  currency: string | null;
  className?: string;
  showCode?: boolean;
}) {
  if (minor === null || !currency)
    return (
      <span
        className={cn("text-muted-foreground", className)}
        title="Not extracted — needs a person"
      >
        Unknown
      </span>
    );
  return (
    <span className={cn("figure whitespace-nowrap", className)}>
      {formatMoney(minor, currency)}
      {showCode ? (
        <span className="ml-1 text-[0.8em] font-medium text-muted-foreground">{currency}</span>
      ) : null}
    </span>
  );
}
