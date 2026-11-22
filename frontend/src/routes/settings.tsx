import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, FlaskConical, Server } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ApprovalRulesSection, AwaySection } from "@/components/sentinel/admin-settings";
import { PageHeader } from "@/components/sentinel/page-header";
import { identitiesQuery } from "@/lib/api/queries";
import { ROLES } from "@/lib/domain/roles";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Brim Sentinel" },
      {
        name: "description",
        content: "Demo identity, approval rules, delegation and what each role may do.",
      },
      { property: "og:title", content: "Settings — Brim Sentinel" },
      { property: "og:description", content: "Demo identity, roles and data source." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, users, setUserId, identityError } = useSession();
  const identities = useQuery(identitiesQuery());
  const awayById = new Map(
    (identities.data?.users ?? [])
      .filter((u) => u.status === "on_leave")
      .map((u) => [u.id, u.delegate_user_id] as const),
  );
  const nameOf = (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? id;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Choose who you're acting as, see the approval rules, and set who covers for an approver who's away."
      />

      <AwaySection />
      <ApprovalRulesSection />

      <section className="surface overflow-hidden" aria-labelledby="identity-heading">
        <header className="flex items-start gap-3 border-b bg-warning-soft px-5 py-4">
          <FlaskConical className="mt-0.5 size-4 text-warning-foreground" aria-hidden />
          <div>
            <h2 id="identity-heading" className="text-sm font-semibold">
              Demo identity — not authentication
            </h2>
            <p className="text-xs text-muted-foreground">
              This picker simulates people at Harborline Logistics. It does not protect data; the
              backend checks every action independently.
            </p>
          </div>
        </header>
        <ul className="divide-y">
          {users.map((u) => {
            const role = ROLES[u.role];
            const active = u.id === user.id;
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => void setUserId(u.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full items-start gap-4 px-5 py-3.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:bg-secondary",
                    active && "bg-primary-soft/60",
                  )}
                >
                  <Avatar className="size-9">
                    <AvatarFallback className="bg-secondary text-xs font-semibold">
                      {u.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {u.name}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {u.title}, {u.department}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs">
                      <span className="font-medium text-success-foreground">Can:</span> {role.can}
                    </p>
                    <p className="text-xs">
                      <span className="font-medium text-critical-foreground">Cannot:</span>{" "}
                      {role.cannot}
                    </p>
                  </div>
                  {awayById.has(u.id) && (
                    <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
                      Away · {nameOf(awayById.get(u.id)) ?? "no delegate"} covers
                    </span>
                  )}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {role.label}
                  </span>
                  {active ? (
                    <Check className="mt-1 size-4 text-primary" aria-label="Current identity" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        className="surface flex items-start gap-3 px-5 py-4"
        aria-labelledby="source-heading"
      >
        <Server className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        <div>
          <h2 id="source-heading" className="text-sm font-semibold">
            Data source
          </h2>
          <p className="text-sm text-muted-foreground">
            {identityError ?? "Sentinel backend · synthetic Harborline Logistics dataset"}
          </p>
        </div>
      </section>
    </div>
  );
}
