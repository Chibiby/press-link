"use client";

import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useSidebarCollapse } from "./Sidebar";

/**
 * The rail's collapse control, in the topbar rather than the rail itself so that
 * one hamburger sits in the same spot at every width: below `lg` MobileNav's
 * opens the drawer, at `lg` and up this one collapses the rail.
 *
 * Desktop-only, because below `lg` there is no rail to collapse — MobileNav's
 * button occupies this slot instead, and exactly one of the two is ever visible.
 */
export function SidebarToggle() {
  const { collapsed, toggle } = useSidebarCollapse();
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-controls="admin-nav"
      aria-label={label}
      title={label}
      // The ghost variant gives `aria-expanded` an active background, which is right
      // for a popover trigger — expanded there means a menu is open. Here expanded is
      // the resting state, so that rule would leave the hamburger looking permanently
      // pressed next to the topbar's other ghost buttons. Both overrides are
      // `!`-important to win regardless of stylesheet order; the hover one carries an
      // extra variant so it still beats the transparent one when the pointer is on it.
      className="hidden aria-expanded:bg-transparent! aria-expanded:hover:bg-muted! lg:inline-flex"
    >
      <Menu className="size-5" />
    </Button>
  );
}
