import { Suspense, type ReactNode } from "react";

import { AttentionBell } from "@/components/admin/shell/AttentionBell";
import { Sidebar } from "@/components/admin/shell/Sidebar";
import { Topbar } from "@/components/admin/shell/Topbar";
import { UserChip } from "@/components/admin/shell/UserChip";

import { loadShellFacts } from "./dashboard-data";

/**
 * The bell and the chip in one async unit, wrapped in Suspense by the layout so the
 * shell and the page below it are not held back by this query. On /admin it costs
 * nothing: cache() has already resolved the same loaders for the page.
 */
async function ShellActions() {
  const { adminName, attentionBadge } = await loadShellFacts();

  return (
    <>
      <AttentionBell count={attentionBadge} />
      <UserChip name={adminName} />
    </>
  );
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
  return (
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
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
