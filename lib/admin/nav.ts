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
  | "judges"
  | "tabulators"
  | "users"
  | "settings"
  | "audit";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  soon?: boolean;
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
    label: "Reference",
    items: [
      { label: "Schools", href: "/admin/schools", icon: "schools", soon: true },
      { label: "Districts", href: "/admin/districts", icon: "districts", soon: true },
      { label: "Events", href: "/admin/events", icon: "events", soon: true },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "School Summary", href: "/admin/summary", icon: "summary", soon: true },
      { label: "Overall Data", href: "/admin/overall-data", icon: "overall", soon: true },
      { label: "Activity Log", href: "/admin/activity", icon: "activity", soon: true },
    ],
  },
  {
    label: "Adjudication",
    items: [
      { label: "Judges Portal", href: "/admin/judges", icon: "judges", soon: true },
      { label: "Tabulators", href: "/admin/tabulators", icon: "tabulators", soon: true },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Users & Access", href: "/admin/users", icon: "users", soon: true },
      { label: "Settings", href: "/admin/settings", icon: "settings", soon: true },
      { label: "Audit Logs", href: "/admin/audit-logs", icon: "audit", soon: true },
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
