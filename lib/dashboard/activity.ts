/**
 * The activity feed.
 *
 * There is no event log in this schema, so the feed is six timestamp columns
 * read newest-first and merged here: entries.submitted_at,
 * participants.created_at, coaches.created_at, schools.paper_answered_at,
 * schools.submission_locked_at and school_papers.updated_at.
 *
 * INVARIANT: fetch each source with the same limit you pass here. Six lists each
 * truncated at n merge to the true newest n, because anything a source dropped is
 * older than that source's own nth row. Ask for 50 while fetching 8 apiece and
 * the tail of the feed is wrong in a way nothing will flag.
 */
export type ActivityKind =
  | "entry"
  | "participant"
  | "coach"
  | "paper-answer"
  | "submission-lock"
  | "paper-update";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string;
  title: string;
  meta: string | null;
  href: string | null;
}

/** A merged feed together with whether anything was held back from it. */
export interface ActivityFeed {
  items: ActivityItem[];
  /**
   * True when this feed is not the whole story, so a panel can say "5 of more"
   * instead of implying it is showing everything.
   *
   * Deliberately conservative, and it is not the same question as
   * `items.length === limit`. Two different things hide rows: this merge slicing
   * at the limit, and the six queries above it each having sliced at the limit
   * first. A source that came back holding exactly `limit` rows was almost
   * certainly cut off by its own `.limit()`, so the feed is truncated even in the
   * case where the merge itself dropped nothing. False therefore means "no row
   * was hidden anywhere", which is the only condition under which a caller may
   * present the list as complete.
   */
  truncated: boolean;
}

const MONTH_DAY = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  // Pinned rather than left to the host: the division is in Manila, and an
  // unpinned formatter would render a different day depending on where the
  // server runs — which would also make the test for this flaky.
  timeZone: "Asia/Manila",
});

/** The separator the rest of the dashboard already uses between meta fragments. */
const META_SEPARATOR = " · ";

/**
 * Merge the sources newest-first and report whether anything was held back.
 *
 * ORDER IS TOTAL. Timestamps tie often in real data — a school locking its
 * submission writes `submission_locked_at` and every entry's `submitted_at` in
 * one action, so those rows can share an instant to the microsecond. Equal
 * instants therefore fall back to ascending `id`, which is unique because it
 * carries the kind and the row id (`entry:1f2e…`). No two items can compare
 * equal, so the feed is byte-identical between renders of the same data.
 */
export function mergeActivityFeed(sources: ActivityItem[][], limit: number): ActivityFeed {
  const cap = Math.max(0, Math.floor(limit));

  const candidates = sources
    .flat()
    // Compared as instants: a lexicographic sort happens to agree with the format
    // Postgres returns today, and stops agreeing the moment an offset differs.
    // `Date.parse` is also the null guard — a nullable column like
    // `paper_answered_at` arrives here as null typed as a string, and NaN fails
    // this filter rather than sorting to the top of an admin's feed.
    .map((item) => ({ item, at: Date.parse(item.at) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => b.at - a.at || a.item.id.localeCompare(b.item.id, "en"));

  const sourceHitItsOwnLimit = cap > 0 && sources.some((source) => source.length >= cap);

  return {
    items: candidates.slice(0, cap).map((entry) => entry.item),
    truncated: candidates.length > cap || sourceHitItsOwnLimit,
  };
}

/**
 * The merged items alone, for callers that render a fixed-size strip and have no
 * "and more" affordance to drive. Prefer {@link mergeActivityFeed} anywhere the
 * surface makes a claim about how much it is showing.
 */
export function mergeActivity(sources: ActivityItem[][], limit: number): ActivityItem[] {
  return mergeActivityFeed(sources, limit).items;
}

/**
 * A person's name as a feed *title* can safely carry it.
 *
 * `coaches.first_name` and `coaches.last_name` both default to '' (migration
 * 0015_restore_coach_name_parts.sql), so `surnameFirst()` legitimately returns ''
 * for a coach whose school has not filled a name in yet. No such row exists in
 * the division today, but the schema permits one, and interpolating '' into a
 * sentence yields "Coach  registered" or a line ending in "registered by " with
 * nothing after it. A title cannot be null, so a blank name becomes a visible
 * placeholder — the caller passes a wording that fits its sentence.
 */
export function personLabel(
  name: string | null | undefined,
  fallback = "Name not yet recorded"
): string {
  return (name ?? "").trim() || fallback;
}

/**
 * Compose an `ActivityItem.meta` line from fragments, dropping the blank ones.
 *
 * The counterpart to {@link personLabel} for the secondary line, where the field
 * *is* nullable: a blank name simply falls out instead of trailing a separator,
 * and if nothing survives the result is null so the panel renders no meta line
 * rather than an empty one.
 */
export function joinMeta(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.map((part) => (part ?? "").trim()).filter((part) => part.length > 0);
  return kept.length > 0 ? kept.join(META_SEPARATOR) : null;
}

/**
 * "3h ago" for the last week, a date beyond it. `now` is injected so this stays
 * pure and testable; the caller passes `new Date()`. These pages are dynamic —
 * they read cookies through the Supabase client — so every request re-renders and
 * the labels are current on arrival.
 */
export function relativeTime(at: string, now: Date): string {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return "";

  // Never render a negative age: a little clock skew between the database and the
  // server is normal and "-3m ago" is not a thing.
  const seconds = Math.max(0, (now.getTime() - then) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return MONTH_DAY.format(new Date(then));
}
