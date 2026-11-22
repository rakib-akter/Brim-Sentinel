import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
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
  setUserId: (id: string, nextPath?: string) => void;
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

  function setUserId(id: string, nextPath?: string) {
    if (id === actor || !users.some((candidate) => candidate.id === id)) return;
    document.cookie = `${COOKIE}=${id}; Path=/; SameSite=Lax; Max-Age=2592000`;
    if (nextPath) window.location.assign(nextPath);
    else window.location.reload();
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
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
