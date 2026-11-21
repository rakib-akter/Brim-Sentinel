import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-background">
        <TopBar />
        <div className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-8 md:px-8">{children}</div>
        <footer className="mx-auto w-full max-w-[1320px] px-4 pb-6 text-[11px] text-muted-foreground md:px-8">
          Prototype with fictional data. All payments are simulated. Risk indicators are advisory and never
          authorize, reject or release a payment.
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
