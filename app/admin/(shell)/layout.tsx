import { Suspense, type ReactNode } from "react";

import { Sidebar, SidebarCollapseProvider } from "@/components/admin/shell/Sidebar";
import { Topbar } from "@/components/admin/shell/Topbar";
import { UserChip } from "@/components/admin/shell/UserChip";

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
          {/* No `mx-auto max-w-7xl` here. A centred cap inside a shell that already has
              a rail spends the leftover width as margin on both sides: with the rail
              collapsed on a 1920px display that was ~290px of dead space per side, and
              it left the page heading floating well right of the topbar's hamburger.
              The rail is the frame, so the content fills what the rail leaves and the
              padding matches Topbar's, which puts both on one left edge. */}
          <main className="w-full flex-1 px-3 py-6 sm:px-4">{children}</main>
        </div>
      </div>
    </SidebarCollapseProvider>
  );
}
