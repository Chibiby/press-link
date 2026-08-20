"use client";

import { useEffect, useId, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Calculator,
  CalendarDays,
  FileText,
  Gavel,
  LayoutDashboard,
  Map,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  School,
  ScrollText,
  Settings,
  ShieldCheck,
  Table2,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { ADMIN_NAV, isNavActive, type NavIcon } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";
import { version as APP_VERSION } from "@/package.json";

// lib/admin/nav.ts stays React-free, so it names icons as strings and this is
// where those names become components.
const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  entries: FileText,
  papers: Newspaper,
  participants: Users,
  coaches: UserCog,
  schools: School,
  districts: Map,
  events: CalendarDays,
  summary: Table2,
  overall: BarChart3,
  activity: Activity,
  judges: Gavel,
  tabulators: Calculator,
  users: ShieldCheck,
  settings: Settings,
  audit: ScrollText,
};

/**
 * The nav list itself, shared by the desktop rail and the mobile drawer.
 * `onNavigate` lets the drawer close itself on a link click; the rail passes
 * nothing. `collapsed` is the rail's icon-only mode — the drawer never sets it,
 * because a drawer that hid its own labels would be pointless.
 *
 * `id` is the caller's to supply, not hardcoded: both navs can be mounted at
 * once (see MobileNav's effect for why `lg:hidden` does not unmount), so a
 * literal here would put two of the same id in the document. The rail passes
 * one because the collapse toggle's `aria-controls` must resolve to the rail's
 * own nav; the drawer passes none. `aria-label` stays hardcoded — a hidden
 * landmark is not in the accessibility tree, so its name cannot collide, and
 * the drawer's nav needs a name just as much as the rail's.
 */
export function AdminNav({
  id,
  onNavigate,
  collapsed = false,
}: {
  id?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  // Group labels are paired to their items below via `aria-labelledby`, which
  // needs a real id. It cannot be derived from the label alone: both navs can
  // be mounted at once (see MobileNav's effect), and duplicate ids would let
  // the drawer's heading name the rail's items. `useId` gives each instance of
  // this component its own prefix, and is stable across server and client.
  const uid = useId();

  return (
    <nav
      id={id}
      aria-label="Admin sections"
      className={cn("flex-1 overflow-y-auto pb-6", collapsed ? "px-1.5" : "px-2")}
    >
      {ADMIN_NAV.map((group) => {
        // A visible heading is not an accessible name. Without this pairing the
        // seven labels are decoration and a screen reader reads sixteen flat
        // links; `role="group"` plus `aria-labelledby` makes each label name
        // the items beneath it, in both the expanded and collapsed rails.
        const labelId = `${uid}-${group.label.toLowerCase()}`;

        return (
          <div key={group.label} role="group" aria-labelledby={labelId} className="mb-4">
            {/* Collapsed, the group label has nowhere to go. A rule keeps the
                grouping visible without it — and the label stays, sr-only, so a
                screen reader does not get sixteen items as one flat list. */}
            {collapsed ? (
              <>
                <div className="mx-2 mb-1 border-t border-sidebar-border" />
                <p id={labelId} className="sr-only">
                  {group.label}
                </p>
              </>
            ) : (
              <p
                id={labelId}
                className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50"
              >
                {group.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];

                // Two different facts: `soon` has no page to open, `stub` has a page
                // that explains itself. Both keep the label. Collapsed, both lose it
                // to a tooltip, so the pill has nothing to sit beside and drops out
                // with it — the icon plus "coming soon" in the tooltip carries it.
                const pill = collapsed ? null : (
                  <span className="shrink-0 rounded border border-sidebar-border px-1 py-px text-[9px] font-medium uppercase tracking-wide">
                    Soon
                  </span>
                );

                const label = collapsed ? (
                  <span className="sr-only">{item.label} — coming soon</span>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                );

                if (item.soon) {
                  return (
                    <li key={item.href}>
                      <span
                        aria-disabled="true"
                        title={collapsed ? `${item.label} — coming soon` : undefined}
                        className={cn(
                          "flex cursor-not-allowed items-center gap-2.5 rounded-md py-2 text-sm text-sidebar-foreground/40",
                          collapsed ? "justify-center px-2" : "px-3"
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        {label}
                        {pill}
                      </span>
                    </li>
                  );
                }

                const active = isNavActive(pathname, item.href);
                // A stub's tooltip says so; a finished page's is just its name.
                const hint = item.stub ? `${item.label} — coming soon` : item.label;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? hint : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md py-2 text-sm transition-colors",
                        collapsed ? "justify-center px-2" : "px-3",
                        active
                          ? "bg-sidebar-primary/15 font-medium text-sidebar-primary"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {collapsed ? (
                        <span className="sr-only">{hint}</span>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      )}
                      {item.stub ? pill : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The comp's footer lockup, at the bottom of the rail and the drawer.
 *
 * Three logos, not the four `components/auth-shell.tsx` shows: the society mark is
 * dropped because a 256px rail cannot carry four and stay legible. The white panel is
 * copied from that file for the same reason it exists there — the DepEd art is
 * transparent, so on the dark sidebar it would render as black-on-black.
 *
 * The version is read from package.json at build time. It is 0.1.0, not the comp's
 * 1.0.0: the comp's number is decoration, this one is a fact.
 */
const LOCKUP = [
  { src: "/logo-deped-matatag.png", alt: "DepEd MATATAG", w: 256, h: 240 },
  {
    src: "/logo-deped-sarangani.png",
    alt: "Department of Education — Division of Sarangani",
    w: 241,
    h: 240,
  },
  { src: "/logo-bagong-pilipinas.png", alt: "Bagong Pilipinas", w: 258, h: 240 },
];

export function SidebarFooter({ collapsed = false }: { collapsed?: boolean }) {
  // A 4rem rail cannot carry three logos at a legible size. Collapsed, the lockup
  // drops out and only the version line stays — the logos are decoration, the
  // version is a fact someone may need to read out over the phone.
  return (
    <div className="mt-auto border-t border-sidebar-border px-3 py-3">
      {collapsed ? null : (
        <div className="flex items-center justify-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-black/5">
          {LOCKUP.map((logo) => (
            <Image
              key={logo.src}
              src={logo.src}
              alt={logo.alt}
              width={logo.w}
              height={logo.h}
              className="h-6 w-auto shrink-0 object-contain"
            />
          ))}
        </div>
      )}
      <p
        className={cn(
          "text-center text-[10px] text-sidebar-foreground/40",
          collapsed ? "" : "pt-2"
        )}
      >
        {collapsed ? APP_VERSION : `PressLink v${APP_VERSION}`}
      </p>
    </div>
  );
}

/** Where the collapse preference is remembered between visits. */
const COLLAPSE_KEY = "presslink.admin.sidebar-collapsed";

/**
 * The desktop rail. Hidden below `lg`, where MobileNav takes over.
 *
 * The comp's collapse control lives here (spec §3.3, "sidebar collapse state").
 * It starts expanded on every render and only then reads `localStorage`, rather
 * than reading it in the `useState` initialiser: the server has no
 * `localStorage`, so initialising from it would render a different tree on the
 * server than on the client and React would throw a hydration mismatch. The
 * cost is one frame of expanded rail for an admin who prefers it collapsed.
 * That is the right trade — a visible flicker beats a console error and a
 * client-side re-render of the whole shell.
 */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Deliberate: the alternative the rule wants is a useState initialiser, which
    // reads localStorage during SSR and hydration-mismatches. Runs once, on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggle() {
    // The write stays out of the updater: React may call an updater more than
    // once (StrictMode does), and updaters must be pure.
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  }

  return (
    <aside
      aria-label="Admin sidebar"
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 py-4",
          collapsed ? "justify-center px-2" : "px-4"
        )}
      >
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <Wordmark subtitle="Division Admin" />
          </div>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="admin-nav"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      </div>
      <AdminNav id="admin-nav" collapsed={collapsed} />
      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}
