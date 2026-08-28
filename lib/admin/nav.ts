/**
 * The admin sidebar's route tree. Kept free of React so the active-state rule
 * can be unit-tested, and so the sidebar holds no route knowledge of its own.
 *
 * `icon` is a string key the sidebar maps to a lucide component. `soon: true`
 * means the page does not exist yet: the sidebar renders it disabled with a
 * "Soon" chip rather than linking to a 404. Each later task that lands a page
 * clears exactly one flag.
 */
export type NavIcon =
  | "dashboard"
  | "entries"
  | "papers"
  | "participants"
  | "coaches"
  | "schools"
  | "districts"
  | "events"
  | "summary"
  | "overall"
  | "activity"
  | "masterlist"
  | "judges"
  | "tabulators"
  | "users"
  | "settings"
  | "audit";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** No route exists yet. Shown in the nav, never linked. */
  soon?: boolean;
  /**
   * The route exists but the feature does not: it renders a Soon page. Linked,
   * and still labelled, so the nav is honest in both directions.
   */
  stub?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/admin", icon: "dashboard" }],
  },
  {
    label: "Submissions",
    items: [
      { label: "Entries", href: "/admin/entries", icon: "entries" },
      { label: "School Papers", href: "/admin/school-papers", icon: "papers" },
    ],
  },
  {
    label: "Roster",
    items: [
      { label: "Participants", href: "/admin/participants", icon: "participants" },
      { label: "Coaches", href: "/admin/coaches", icon: "coaches" },
    ],
  },
  {
    label: "Overall Data",
    items: [
      { label: "Schools", href: "/admin/schools", icon: "schools" },
      { label: "Districts", href: "/admin/districts", icon: "districts" },
      { label: "Events", href: "/admin/events", icon: "events" },
    ],
  },
  {
    label: "Reports",
    items: [
      // School Summary and Overall Data were both pulled from the rail; their routes
      // and pages stay live for anyone with the direct URL, so this drops the links
      // and nothing else.
      { label: "Activity Log", href: "/admin/activity", icon: "activity" },
      // `stub`, like the System three: /admin/masterlist exists and renders a SoonPage,
      // so the rail links it and the page itself says what it is waiting on.
      { label: "Masterlist", href: "/admin/masterlist", icon: "masterlist", stub: true },
    ],
  },
  {
    label: "Adjudication",
    items: [
      // No longer stubs: both routes render their real layout over real event data,
      // and say on the page itself which of their figures the judging schema cannot
      // supply yet. `stub` is reserved for a route whose page is a SoonPage.
      { label: "Judges Portal", href: "/admin/judges", icon: "judges" },
      { label: "Tabulators", href: "/admin/tabulators", icon: "tabulators" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Users & Access", href: "/admin/users", icon: "users" },
      { label: "Settings", href: "/admin/settings", icon: "settings", stub: true },
      { label: "Audit Logs", href: "/admin/audit-logs", icon: "audit" },
    ],
  },
];

/**
 * "/admin" is the dashboard itself, so it matches exactly — prefix matching
 * would light it up on every admin page. Every other item also claims its
 * children, but only on a full segment boundary, so "/admin/entries" does not
 * claim "/admin/entries-archive".
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A sidebar click the router has not caught up with yet.
 *
 * `href` alone would be enough to move the highlight, but not enough to know
 * when to stop trusting it, so the pathname the click was made *from* is
 * recorded with it. That pairing is the whole rule: while the URL is still the
 * one the admin clicked from, the click has not landed and the optimistic
 * highlight stands; the moment the pathname is anything else the record is
 * stale and the real URL wins.
 *
 * Comparing against `from` rather than asking "have we arrived at `href` yet?"
 * is deliberate. A back button pressed mid-navigation, or a redirect from the
 * page itself, moves the URL somewhere the clicked item does not cover — and an
 * "arrived?" test would answer no forever and leave the wrong item lit for the
 * rest of the session.
 */
export interface PendingNav {
  /** The item that was clicked. */
  href: string;
  /** The pathname at the moment of the click. */
  from: string;
}

/**
 * The clicked item's href while it is still worth showing, or null once the
 * router has moved and the pathname can speak for itself.
 */
export function pendingNavHref(pathname: string, pending: PendingNav | null): string | null {
  if (!pending) return null;
  return pending.from === pathname ? pending.href : null;
}

/**
 * The path the sidebar should compute its active item from: the pending click
 * if there is a live one, otherwise the real pathname.
 *
 * This is what makes the rail highlight on click instead of on arrival. It is
 * here rather than in the sidebar for the same reason `isNavActive` is — the
 * rail is not where route rules get decided, and a rule with no test is a rule
 * that gets quietly broken by the next person to touch the component.
 */
export function resolveNavPath(pathname: string, pending: PendingNav | null): string {
  return pendingNavHref(pathname, pending) ?? pathname;
}
