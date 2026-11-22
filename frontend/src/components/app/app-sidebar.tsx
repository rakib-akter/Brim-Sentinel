import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CheckSquare,
  FileText,
  History,
  LayoutDashboard,
  SearchCheck,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { homeQuery } from "@/lib/api/queries";
import { useSession } from "@/lib/session";
import { BrandMark } from "./brand-mark";

type NavTo =
  | "/"
  | "/invoices"
  | "/approvals"
  | "/payments"
  | "/vendors"
  | "/investigations"
  | "/analytics"
  | "/audit"
  | "/settings";

interface NavItem {
  to: NavTo;
  label: string;
  icon: LucideIcon;
  badge?: "attention" | "approvals";
}

const WORK: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/invoices", label: "Invoices", icon: FileText, badge: "attention" },
  { to: "/approvals", label: "Approvals", icon: CheckSquare, badge: "approvals" },
  { to: "/payments", label: "Payments", icon: Wallet },
  { to: "/vendors", label: "Vendors", icon: Building2 },
];

const OVERSIGHT: NavItem[] = [
  { to: "/investigations", label: "Cases", icon: SearchCheck },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/audit", label: "Audit", icon: History },
];

function NavList({ items, counts }: { items: NavItem[]; counts: Record<string, number> }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <SidebarMenu>
      {items.map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        const count = item.badge ? counts[item.badge] : 0;
        return (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              asChild
              isActive={active}
              tooltip={item.label}
              className="h-10 rounded-md px-3 text-[13px] font-medium text-sidebar-foreground/80 hover:bg-secondary/70 hover:text-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
            >
              <Link to={item.to}>
                <item.icon aria-hidden />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
            {count ? (
              <SidebarMenuBadge className="figure rounded-full bg-primary-soft text-accent-foreground">
                {count}
              </SidebarMenuBadge>
            ) : null}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const { user, permissions } = useSession();
  const { data } = useQuery(homeQuery(user.id));
  // Counts appear after hydration so server and browser render the same markup.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const counts = {
    attention: mounted ? (data?.needsAttention.length ?? 0) : 0,
    approvals: mounted ? (data?.readyForApproval.length ?? 0) : 0,
  };
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="border-b border-sidebar-border px-4 pb-5 pt-6">
        <Link to="/" className="flex items-center gap-3 rounded-lg px-1 py-1">
          <BrandMark className="size-9 shrink-0" />
          <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <p className="text-[15px] font-semibold tracking-[-0.035em] text-foreground">
              Brim Sentinel
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              Harborline Logistics
            </p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2 pt-4">
        <SidebarGroup>
          <SidebarGroupLabel className="eyebrow">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavList items={WORK} counts={counts} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="eyebrow">Control & reporting</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavList
              items={OVERSIGHT.filter(
                (item) => item.to !== "/audit" || permissions.includes("audit.read_all"),
              )}
              counts={counts}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-3 pb-4 pt-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith("/settings")}
              tooltip="Settings"
              className="h-10 rounded-md px-3 text-[13px] font-medium text-sidebar-foreground/80 hover:bg-secondary/70 hover:text-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
            >
              <Link to="/settings">
                <Settings aria-hidden />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <p className="px-2 pt-2 text-[11px] leading-snug text-muted-foreground group-data-[collapsible=icon]:hidden">
          Detect. Resolve. Settle. Explain.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
