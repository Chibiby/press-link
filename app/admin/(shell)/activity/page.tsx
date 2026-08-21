import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ActivityItem } from "@/lib/dashboard/activity";
import { fetchActivity } from "@/lib/dashboard/activity-source";

/**
 * 50 per source, so the merged feed is the true newest 50 in the division.
 *
 * Not paginated. Six sources with six different cursors is a real design problem and the
 * feed is not the tool for "everything a school ever did" — /admin/overall-data,
 * /admin/summary and the roster pages each answer that for their own slice, completely and
 * with filters. What this page is for is "what changed lately", and 50 rows covers that.
 */
const ACTIVITY_LIMIT = 50;

/** Grouping label for a row's day, in Manila — the division's clock. */
const DAY_LABEL = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila",
});

export default async function AdminActivityPage() {
  const { supabase } = await requireAdmin();
  const feed = await fetchActivity(supabase, ACTIVITY_LIMIT);
  const items = feed.items;

  // One `now` for the whole response, as on the dashboard: two rows rendered a millisecond
  // apart must not disagree about what "2m ago" means.
  const now = new Date();

  // Group by Manila day, preserving the merge's newest-first order. A plain object would
  // reorder date-like keys in some engines; a Map preserves insertion order by spec.
  const days = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const day = DAY_LABEL.format(new Date(item.at));
    const bucket = days.get(day);
    if (bucket) bucket.push(item);
    else days.set(day, [item]);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title="Activity Log"
        badge={items.length === 0 ? "Quiet" : `Newest ${items.length}`}
        subtitle="Entries, learners, coaches, school-paper answers, paper edits and submission locks — newest first, division-wide."
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing has happened yet. Rows appear here as schools build their rosters and
            submit entries.
          </CardContent>
        </Card>
      ) : (
        [...days].map(([day, dayItems]) => (
          <Card key={day}>
            <CardHeader>
              <CardTitle className="text-base">{day}</CardTitle>
              <CardDescription>
                {dayItems.length === 1 ? "1 change" : `${dayItems.length} changes`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* `truncated` is not passed to a day's card: the flag is a property of the
                  whole 50-row feed, and a per-day panel claiming its own day was cut
                  would be a different, false statement. The page says it below instead. */}
              <ActivityFeed items={dayItems} now={now} />
            </CardContent>
          </Card>
        ))
      )}

      <p className="text-xs text-muted-foreground">
        {feed.truncated
          ? `Showing the newest ${items.length} changes. Older ones are not listed here — the school, district and roster pages each hold the complete record for their own slice. `
          : ""}
        Assembled from the timestamps the database already keeps. There is no separate audit
        log, so this shows when a record was created or last changed — not who changed it, and
        not what it said before.
      </p>
    </div>
  );
}
