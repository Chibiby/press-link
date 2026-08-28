import {
  HeadingSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";

/**
 * The whole admin shell's default fallback.
 *
 * It sits at the route group's root, so it is the boundary every admin route
 * inherits unless it ships one of its own — and because the sidebar and topbar
 * live in the group's `layout.tsx`, it replaces `<main>` alone. The rail stays
 * put and stays interactive while the page below it loads, which is the point:
 * the click lands on a page that is already there.
 *
 * It is deliberately generic — a heading and a table, which is what most admin
 * routes are. It is also the dashboard's fallback, because the dashboard is
 * this group's own `page.tsx` and a segment cannot hold two different loading
 * files. Tuning this one to the dashboard's six KPI tiles would flash a stat
 * row on `/admin/activity`, `/admin/coaches` and every other list route that
 * has none, so the dashboard gets the generic shape and the routes whose layout
 * genuinely differs override it next to their own `page.tsx`.
 */
export default function AdminShellLoading() {
  return (
    <PageSkeleton label="Loading the page">
      <HeadingSkeleton />
      <TableSkeleton columns={6} />
    </PageSkeleton>
  );
}
