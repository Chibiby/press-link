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
