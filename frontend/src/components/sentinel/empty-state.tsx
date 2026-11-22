import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${compact ? "px-4 py-8" : "px-6 py-14"}`}
    >
      <div className="mb-3 grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
