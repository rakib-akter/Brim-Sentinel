import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_USER_ID, findUser } from "@/lib/domain/roles";
import type { User } from "@/lib/domain/types";

/**
 * Demo identity — not authentication. The selected user is sent to the API as the
 * acting identity; the backend decides what that identity may see and do.
 */
interface SessionValue {
  user: User;
  setUserId: (id: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);
const STORAGE_KEY = "sentinel.demo-identity";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState(DEFAULT_USER_ID);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setUserIdState(stored);
  }, []);

  const setUserId = useCallback((id: string) => {
    setUserIdState(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo(() => ({ user: findUser(userId), setUserId }), [userId, setUserId]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
