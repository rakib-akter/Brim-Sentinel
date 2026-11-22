import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { identitiesQuery, meQuery } from "@/lib/api/queries";
import { presentUser } from "@/lib/api/presentation";
import type { User } from "@/lib/domain/types";

const COOKIE = "sentinel-demo-identity";
const DEFAULT_ACTOR = "U004";
const readIdentity = createIsomorphicFn()
  .server(() => getCookie(COOKIE))
  .client(() =>
    document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1),
  );

export function getDemoActor() {
  const id = readIdentity();
  return id && /^U\d{3}$/.test(id) ? id : DEFAULT_ACTOR;
}

interface SessionValue {
  user: User;
  users: User[];
  permissions: string[];
  setUserId: (id: string, nextPath?: string) => Promise<void>;
  identityError: string | undefined;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ actor, children }: { actor: string; children: ReactNode }) {
  const me = useQuery(meQuery(actor));
  const identities = useQuery(identitiesQuery());
  const users = (identities.data?.users ?? [])
    .filter((user) => user.kind === "human")
    .map(presentUser);
  const user = me.data
    ? presentUser(me.data.user)
    : {
        id: actor,
        name: actor,
        title: "Demo identity",
        role: "requester" as const,
        department: "",
        initials: "—",
      };

  const router = useRouter();
  const [switchingTo, setSwitchingTo] = useState<User | null>(null);

  // Switch identity in place: write the cookie, then let the router re-run the root
  // beforeLoad (which re-reads it) instead of reloading the whole page. Queries are
  // keyed by actor, so the new person's data loads while an overlay fades over.
  async function setUserId(id: string, nextPath?: string) {
    const next = users.find((candidate) => candidate.id === id);
    if (id === actor || !next) {
      if (nextPath) await router.navigate({ href: nextPath });
      return;
    }
    document.cookie = `${COOKIE}=${id}; Path=/; SameSite=Lax; Max-Age=2592000`;
    setSwitchingTo(next);
    try {
      const minDelay = new Promise((resolve) => setTimeout(resolve, 450));
      if (nextPath) await router.navigate({ href: nextPath });
      await Promise.all([router.invalidate(), minDelay]);
    } catch {
      if (nextPath) window.location.assign(nextPath);
      else window.location.reload();
      return;
    }
    setSwitchingTo(null);
  }

  return (
    <SessionContext.Provider
      value={{
        user,
        users,
        permissions: me.data?.permissions ?? [],
        setUserId,
        identityError: (me.error ?? identities.error)?.message,
      }}
    >
      {children}
      {switchingTo ? <SwitchingOverlay user={switchingTo} /> : null}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

function SwitchingOverlay({ user }: { user: User }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="flex items-center gap-3 rounded-xl border bg-card px-5 py-4 shadow-lg animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {user.initials}
        </span>
        <div>
          <p className="text-sm font-medium">Switching to {user.name}</p>
          <p className="text-xs text-muted-foreground">{user.title}</p>
        </div>
        <span className="ml-2 size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    </div>
  );
}
