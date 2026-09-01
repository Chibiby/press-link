import { LogOut } from "lucide-react";

import { adminSignOutAction } from "@/app/admin/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { SHELL_INSET } from "./inset";
import { MobileNav } from "./MobileNav";
import { SidebarToggle } from "./SidebarToggle";

/**
 * Division identity and session controls only. Per-page titles live in
 * <PageHeading> inside each page, because a layout cannot know which page
 * rendered beneath it.
 *
 * The leading slot holds one hamburger at every width: <SidebarToggle> collapses
 * the rail at `lg` and up, <MobileNav> opens the drawer below it, and exactly one
 * of the two is ever visible.
 *
 * `actions` is a slot for right-aligned, page-independent controls — the layout
 * fills it with the attention bell in phase 2.
 */
export function Topbar({
  actions,
  badges,
}: {
  actions?: React.ReactNode;
  /** Passed through to the drawer, so the narrow rail carries the same counts. */
  badges?: Record<string, number>;
}) {
  return (
    // The bar is full-bleed so its border and blur reach both edges of the shell, while
    // the row inside it takes the same inset as the page content — that shared inset is
    // what puts the hamburger and the page heading on one left edge.
    <header className="sticky top-0 z-30 shrink-0 border-b bg-background/85 backdrop-blur">
      <div className={cn(SHELL_INSET, "flex h-14 items-center gap-2")}>
        <SidebarToggle />
        <MobileNav badges={badges} />
        {/* The wordmark is in the rail on desktop, so it only shows here on narrow screens. */}
        <div className="min-w-0 flex-1 lg:hidden">
          <Wordmark />
        </div>
        <div className="hidden flex-1 lg:block" />
        {actions}
        <ThemeToggle />
        <form action={adminSignOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
