import type { LucideIcon } from "lucide-react";
import { PageHeader } from "./page-header";

export function ComingSoon({
  eyebrow,
  title,
  description,
  phase,
  icon: Icon,
  planned,
}: {
  eyebrow: string;
  title: string;
  description: string;
  phase: string;
  icon: LucideIcon;
  planned: string[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <section className="surface dot-grid grid gap-8 overflow-hidden p-8 md:grid-cols-[auto_1fr]">
        <div className="grid size-14 place-items-center rounded-2xl bg-card text-primary shadow-raised">
          <Icon className="size-6" aria-hidden />
        </div>
        <div>
          <span className="inline-flex rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
            Planned · {phase}
          </span>
          <h2 className="mt-3 text-lg font-semibold tracking-tight">What this page will do</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {planned.map((p) => (
              <li key={p} className="flex gap-2 rounded-lg bg-card/80 px-3 py-2 text-sm">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
