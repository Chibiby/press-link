import { Suspense, type ReactNode } from "react";

import { SHELL_INSET } from "@/components/admin/shell/inset";
import { Sidebar, SidebarCollapseProvider } from "@/components/admin/shell/Sidebar";
import { Topbar } from "@/components/admin/shell/Topbar";
import { UserChip } from "@/components/admin/shell/UserChip";
import { cn } from "@/lib/utils";

import { loadAdminName } from "./dashboard-data";

/**
 * The chip on its own async unit, wrapped in Suspense by the layout so the shell and
 * the page below it are not held back by this query. On /admin it costs nothing:
 * cache() has already resolved the same loader for the page.
 */
async function ShellActions() {
  return <UserChip name={await loadAdminName()} />;
}

/**
 * The admin shell. It lives in a route group, so /admin/login — which sits outside the
 * group — renders without it. Route groups are not part of the URL, so every existing
 * admin path is unchanged.
 *
 * No guard here on purpose: every page still calls requireAdmin() itself, which is what
 * keeps pages and route handlers independently protected rather than both leaning on one
 * layout. ShellActions reaches it through getAdminClient(), so an expired session in the
 * chrome redirects exactly as it does in the page.
 */
export default function AdminShellLayout({ children }: { children: ReactNode }) {
  // The provider wraps the whole shell because the rail reads the collapse state and
  // the topbar's hamburger writes it, and those two are siblings — this is the deepest
  // node that contains both. {children} stays server-rendered either way.
  return (
    <SidebarCollapseProvider>
      <div className="flex min-h-svh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            actions={
              <Suspense fallback={null}>
                <ShellActions />
              </Suspense>
            }
          />
          {/* SHELL_INSET, not a cap of its own: the topbar row carries the same one, so
              the hamburger and the page heading share a left edge. */}
          <main className={cn(SHELL_INSET, "flex-1 py-6")}>{children}</main>
        </div>
      </div>
    </SidebarCollapseProvider>
  );
}
