import { LogOut } from "lucide-react";

import { adminSignOutAction } from "@/app/admin/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

import { MobileNav } from "./MobileNav";

/**
 * Division identity and session controls only. Per-page titles live in
 * <PageHeading> inside each page, because a layout cannot know which page
 * rendered beneath it.
 *
 * `actions` is a slot for right-aligned, page-independent controls — the layout
 * fills it with the attention bell in phase 2.
 */
export function Topbar({ actions }: { actions?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-4">
      <MobileNav />
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
    </header>
  );
}
