/**
 * The two things the activity panel has to decide that are not a property of a
 * single row: where the pre-tracking divider goes, and which rows are sessions
 * still being worked in.
 *
 * Both live here rather than in `ActivityFeed.tsx` because nothing in this repo
 * renders a component under test, so a rule left inside the JSX is permanently
 * unasserted — the same reasoning `lock-state.ts` records. What the component
 * does with the answers is presentation; whether a divider appears at all is not.
 *
 * Everything below is derived from `ActivityItem` alone. The component is handed
 * `items`, `now` and `truncated` by two callers (`/admin` and `/admin/activity`)
 * and nothing else, and in particular it is not handed
 * `app_settings.activity_log_started_at`. So the boundary is read off the ids,
 * which the design already makes load-bearing and disjoint (§5: `session:` never
 * collides with `entry:`).
 */
import type { ActivityItem } from "./activity";
import type { ActivityEventKind } from "./activity-sessions";

/** The id prefix `groupActivitySessions` gives a grouped session. */
const SESSION_PREFIX = "session:";

/**
 * The prefix that opens a row's id, which is the vocabulary it came from.
 *
 * `activity-source.ts` builds the six legacy rows as `<ActivityKind>:<rowid>` —
 * `entry:`, `participant:`, `coach:`, `paper-answer:`, `submission-lock:`,
 * `paper-update:`. `activity-sessions.ts` builds an ungrouped log row as
 * `<ActivityEventKind>:<rowid>` — `entry-submitted:`, `paper-answered:`,
 * `submission-locked:`, `paper-updated:` and so on. No string appears in both
 * lists, and the near-misses are near-misses rather than collisions
 * (`paper-answer` vs `paper-answered`), so an exact token match separates a row
 * that came out of `activity_events` from a row that came out of the six legacy
 * timestamp columns.
 *
 * Typed as a total record over `ActivityEventKind` on purpose: widening the
 * database's kind vocabulary is a migration plus an edit to that union, and this
 * object stops compiling until the new kind is classified here too.
 */
const LOGGED_KIND: Record<ActivityEventKind, true> = {
  "participant-added": true,
  "participant-removed": true,
  "participant-moved": true,
  "participant-entered": true,
  "coach-added": true,
  "coach-removed": true,
  "entry-submitted": true,
  "entry-withdrawn": true,
  "paper-updated": true,
  "paper-answered": true,
  "submission-locked": true,
};

const LOGGED_TOKENS: ReadonlySet<string> = new Set(Object.keys(LOGGED_KIND));

/**
 * The label's fixed half. Design §4 words it
 * `Before session tracking (23 Aug 2026)`; the parenthetical here says `up to`
 * and names a date this feed actually carries — see {@link dividerLabel}.
 */
const DIVIDER_LABEL = "Before session tracking";

const DIVIDER_DAY = new Intl.DateTimeFormat("en-PH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  // Pinned like `activity.ts`'s MONTH_DAY and every other formatter in the repo:
  // the division is in Manila, and an unpinned formatter puts a row on a
  // different day depending on where the server runs.
  timeZone: "Asia/Manila",
});

/**
 * True when this row came from the log rather than from the six legacy
 * timestamp columns — a grouped session, or one `activity_events` row that
 * carried no `session_id` claim.
 */
export function isLoggedRow(item: ActivityItem): boolean {
  if (item.id.startsWith(SESSION_PREFIX)) return true;
  const colon = item.id.indexOf(":");
  // No `:` at all is neither shape. Read as not-logged rather than matching the
  // bare token: an id with no row behind it is malformed, and the two rules
  // differ only in whether such a row lands above the divider or below it, where
  // below is the quieter wrong answer.
  if (colon === -1) return false;
  return LOGGED_TOKENS.has(item.id.slice(0, colon));
}

/** The prefix `groupActivitySessions` writes on an open session's meta (design §2). */
export const IN_PROGRESS_META = "In progress";

/**
 * True for a session that has not been superseded or gone idle, so the panel can
 * mark it live.
 *
 * Read off the meta string the pure function already produced rather than
 * recomputed: open-ness is a function of `now`, of the newest session per school
 * and of the idle window, and a second implementation here would be a second
 * answer. `activity-feed-view.test.ts` drives `groupActivitySessions` itself and
 * asserts this agrees with it, so if that wording ever changes the test fails
 * instead of the badge silently never appearing again.
 */
export function isSessionInProgress(item: ActivityItem): boolean {
  return item.kind === "session" && (item.meta ?? "").startsWith(IN_PROGRESS_META);
}

export interface ActivityDivider {
  /** `items[index]` is the first row that belongs *under* the divider. */
  index: number;
  label: string;
}

/**
 * Where to break the feed between what the log recorded and what predates it,
 * or null when there is no such break to draw.
 *
 * Null in the two cases that matter, and they are the reason this is a function
 * and not a `<hr>` in the markup:
 *
 * - **Nothing is logged.** Migrations 0024/0025 are not applied in production, so
 *   every row is legacy and the whole feed is pre-tracking. A divider over all of
 *   it would be a heading with nothing to contrast against — a visible defect, and
 *   the state the feed is actually in today.
 * - **Everything is logged.** Once the legacy rows fall out of the newest-N
 *   window there is nothing below the line, and a divider with no section under it
 *   is the same defect the other way up.
 *
 * The split is taken as "after the last logged row" rather than "at the first
 * legacy row". The two agree, because the read path gates the legacy sources to
 * `at < activity_log_started_at` and the log holds nothing older than that, so the
 * legacy rows are a contiguous tail of a newest-first feed. They are only asked to
 * agree in one direction: if the two ever did interleave, this rule leaves a legacy
 * row above the divider unlabelled, where the other rule would put a logged row
 * under a heading that says it predates the log. An omission over a false claim.
 */
export function untrackedDivider(items: ActivityItem[]): ActivityDivider | null {
  let lastLogged = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (isLoggedRow(items[i])) lastLogged = i;
  }

  const index = lastLogged + 1;
  if (lastLogged === -1 || index >= items.length) return null;

  return { index, label: dividerLabel(items[index].at) };
}

/**
 * `Before session tracking (up to Aug 23, 2026)`.
 *
 * The date is the newest row *under* the divider, not the cutoff: the cutoff is
 * `app_settings.activity_log_started_at` and no caller passes it here. That makes
 * this the strongest claim the feed can support without inventing one — every row
 * below the line is this date or older, which is exactly what the reader needs to
 * know, and it is true whatever the cutoff turns out to be. Hence `up to` rather
 * than §4's bare parenthetical, which would read as the day tracking began.
 *
 * Formatted here, and this module is only ever reached from a server component, so
 * the string is built once on the server and shipped as HTML — the fix
 * `SubmissionsLockDialog` documents. There is no AM/PM in it either, which is the
 * part Node's ICU and the browser's disagree about.
 */
function dividerLabel(at: string): string {
  const day = Date.parse(at);
  // An unparseable timestamp cannot reach here through `mergeActivityFeed`, which
  // drops non-finite instants. Guarded anyway because the alternative is the
  // string "Invalid Date" in a heading.
  return Number.isFinite(day) ? `${DIVIDER_LABEL} (up to ${DIVIDER_DAY.format(day)})` : DIVIDER_LABEL;
}
