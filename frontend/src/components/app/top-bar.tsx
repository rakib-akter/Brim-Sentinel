import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, FlaskConical, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ROLES } from "@/lib/domain/roles";
import { useSession } from "@/lib/session";

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void navigate({ to: "/invoices", search: { q: q.trim() || undefined } });
  };
  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-md">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <label htmlFor="global-search" className="sr-only">
        Search invoices and suppliers
      </label>
      <Input
        id="global-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search supplier, invoice number or ID"
        className="h-9 rounded-lg border-border bg-background pl-9 shadow-none"
      />
    </form>
  );
}

function IdentityMenu() {
  const { user, users, setUserId, identityError } = useSession();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:shadow-focus">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary-soft text-xs font-semibold text-accent-foreground">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden leading-tight md:block">
            <span className="block text-sm font-medium">{user.name}</span>
            <span className="block text-[11px] text-muted-foreground">
              {ROLES[user.role].label}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
        <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-warning-foreground">
          <FlaskConical className="size-3.5" aria-hidden />
          Demo identity — not authentication
        </DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Switch people to see each role's view. The backend decides what each identity may do.
        </p>
        <DropdownMenuSeparator />
        {identityError ? (
          <p role="alert" className="px-2 text-xs">
            {identityError}
          </p>
        ) : null}
        {users.map((u) => (
          <DropdownMenuItem key={u.id} onSelect={() => setUserId(u.id)} className="gap-3 py-2">
            <Avatar className="size-7">
              <AvatarFallback className="bg-secondary text-[11px] font-semibold">
                {u.initials}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-sm">{u.name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {ROLES[u.role].label} · {u.department}
              </span>
            </span>
            {u.id === user.id ? (
              <Check className="size-4 text-primary" aria-label="Current" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">Settings</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const { user } = useSession();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/85 px-4 backdrop-blur md:px-6">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground lg:inline-flex">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          Viewing as {ROLES[user.role].label}
        </span>
        <IdentityMenu />
      </div>
    </header>
  );
}
