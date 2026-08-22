"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

import { AdminNav, SidebarFooter } from "./Sidebar";

/**
 * Hand-rolled rather than shadcn's Sheet: the repo has no sheet component and
 * this needs no new dependency. Escape closes it, the backdrop closes it, a
 * link click closes it via AdminNav's onNavigate, and crossing into desktop
 * closes it too — see the effect below for why that last one is not optional.
 *
 * ## Why the drawer is portalled and not simply `fixed`
 *
 * The trigger lives in `<Topbar>`, whose header carries `backdrop-blur`. Any
 * non-`none` `filter` or `backdrop-filter` makes that element the containing
 * block for `position: fixed` descendants, so rendering the drawer in place
 * measured `inset-0` against the 3.5rem header strip instead of the viewport:
 * the backdrop dimmed only the header (the page below stayed bright), the panel
 * was one header tall so `bg-sidebar` painted only that strip and the page
 * showed through everything spilling out below it, the nav's `flex-1
 * overflow-y-auto` collapsed to a sliver showing just the first group label,
 * and the footer's white logo lockup floated loose over the page.
 *
 * Portalling to `document.body` is the fix and it is also the repo's existing
 * idiom — `DialogContent` and `AlertDialogContent` both wrap their
 * `fixed inset-0` in a Radix `Portal` for the same reason. Do not "simplify"
 * this back to an inline `fixed`: it would work only for as long as no ancestor
 * of the topbar gains a filter, transform, perspective or `contain`.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    // The drawer is hidden by `lg:hidden`, which is CSS: the element stays
    // mounted and merely goes display:none. Widening past the breakpoint would
    // otherwise leave `open` true and body scroll locked, with no visible
    // drawer to explain why the page will not scroll. 64rem is Tailwind v4's
    // `lg` — app/globals.css sets no --breakpoint-* override.
    const desktop = window.matchMedia("(min-width: 64rem)");
    const onDesktop = () => {
      if (desktop.matches) setOpen(false);
    };

    // Capture rather than assume: resetting to "" would discard any overflow
    // an ancestor had already set.
    const previousOverflow = document.body.style.overflow;

    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onDesktop);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onDesktop);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>

      {/* `open` starts false and only a click can set it, so this branch never
          runs during the server render and `document` is always there when it
          does. */}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 lg:hidden">
              {/* A mouse affordance only. The X button is the real control, so this
                  stays out of the accessibility tree rather than announcing a second
                  "Close navigation" with the same name. Escape and the X keep every
                  keyboard path open. */}
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                className="absolute inset-0 bg-black/50"
                onClick={() => setOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r bg-sidebar text-sidebar-foreground shadow-xl">
                {/* The nav below is `flex-1` from a zero basis, so it takes all
                    the room this row leaves and scrolls inside it. shrink-0 only
                    guards the degenerate case — a drawer shorter than its own
                    chrome — where the wordmark and close button would otherwise
                    be squashed instead. */}
                <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-4">
                  <Wordmark subtitle="Division Admin" />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close navigation"
                    onClick={() => setOpen(false)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <AdminNav onNavigate={() => setOpen(false)} />
                <SidebarFooter />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
