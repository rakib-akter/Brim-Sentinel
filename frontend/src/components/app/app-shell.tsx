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
        <main id="main-content" className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-8 md:px-9 md:py-10 xl:px-12">{children}</main>
        <footer className="mx-auto w-full max-w-[1440px] px-5 pb-7 text-[11px] text-muted-foreground md:px-9 xl:px-12">
          Brim Sentinel demonstration · Fictional records · Payments are simulated · Risk indicators never override payment controls.
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
