import type { ReactNode } from "react";

import { Sidebar } from "@/components/admin/shell/Sidebar";
import { Topbar } from "@/components/admin/shell/Topbar";

/**
 * The admin shell. It lives in a route group, so /admin/login — which sits
 * outside the group — renders without it. Route groups are not part of the URL,
 * so every existing admin path is unchanged.
 *
 * No guard here on purpose: every page still calls requireAdmin() itself, which
 * is what keeps pages and route handlers independently protected rather than
 * both leaning on one layout.
 */
export default function AdminShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
