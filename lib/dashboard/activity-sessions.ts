/**
 * The activity feed, grouped per session instead of per action.
 *
 * The ask was "instead of school entered learners logged 5 times, just 1 log of
 * this school added 5 learners 5 coaches and entry for 6 events". So the unit of
 * this feed is a login-to-logout session, and the row a reader sees is a
 * *sentence* — which is why the wording lives in {@link describeSession} as a
 * pure function whose output strings are asserted directly, rather than being
 * assembled inside a component where nothing can test the English.
 *
 * Session identity arrives already resolved: `activity_events.session_id` is
 * stamped by a trigger from the JWT's `session_id` claim (design §1). Nothing
 * here infers a session from timestamps — a school locking its submissions
 * stamps `submission_locked_at` and every `entries.submitted_at` in one instant,
 * so clustering by time would collapse a whole history into one fabricated
 * session (design §4). A row that carried no claim renders on its own instead.
 *
 * REPLACES the old fetch invariant at `activity.ts:9-12`. That rule was "fetch
 * each source with the same limit you pass the merge", and it held because the
 * limit bounded rows. A limit now bounds *sessions*, so the rule becomes: never
 * fetch a partial session. A session fetched half-way renders "added 3 learners"
 * for a session that added 9 — the same silent wrongness the old rule guarded
 * against, and nothing downstream can detect it. The caller therefore probes
 * `limit + 1` session ids and fetches every row of the first `limit`, then passes
 * the probe count in as {@link SessionInput.sessionsProbed} so this function can
 * report truncation honestly.
 */
import {
  joinMeta,
  mergeActivityFeed,
  personLabel,
  type ActivityFeed,
  type ActivityItem,
  type ActivityKind,
} from "./activity";

/**
 * The fixed `activity_events.kind` vocabulary (design §3's check constraint).
 *
 * Insert and update on `school_papers` both write `paper-updated` on purpose: a
 * reader does not distinguish "created the paper record" from "edited it", and
 * two kinds here would force the sentence to say "added its school paper and
 * updated its school paper" for a session that did both in one sitting. The
 * legacy `paper-update` source is likewise driven by `updated_at` alone.
 */
export type ActivityEventKind =
  | "participant-added"
  | "participant-removed"
  | "coach-added"
  | "coach-removed"
  | "entry-submitted"
  | "entry-withdrawn"
  | "paper-updated"
  | "paper-answered"
  | "submission-locked";

/** One `activity_events` row, already joined to its school's name. */
export interface SessionEvent {
  id: string;
  sessionId: string | null;
  at: string;
  schoolName: string;
  kind: ActivityEventKind;
  /** Denormalised subject name; the source row may since have been deleted. */
  label: string | null;
}

export interface SessionInput {
  events: SessionEvent[];
  /** Session ids whose event fetch hit the per-session cap, so their tallies are floors. */
  capped: Set<string>;
  /** Pre-cutoff rows from the six legacy timestamp columns, already built into items. */
  legacy: ActivityItem[];
  /** How many session ids the probe saw; more than `limit` means one was left out. */
  sessionsProbed: number;
  limit: number;
  /**
   * Injected, never read from the clock. Whether a session is still open is a
   * function of this value, so a test can hold time still and two renders of the
   * same data agree; `new Date()` inside would make both impossible. Same
   * reasoning as `relativeTime`.
   */
  now: Date;
  idleMinutes?: number;
}

/**
 * A session's tally, keyed by kind, with every key optional.
 *
 * Optional rather than a total `Record<ActivityEventKind, number>` because a
 * category that did not happen is *absent* — which is the same rule the sentence
 * follows: omit it entirely rather than write "0 coaches". One shape, one rule.
 */
export type KindCounts = { readonly [K in ActivityEventKind]?: number };

/** The mutable form the tally is accumulated in before it is read as a {@link KindCounts}. */
type MutableKindCounts = Partial<Record<ActivityEventKind, number>>;

/** Minutes of silence after which a session is treated as over (design §2). */
const DEFAULT_IDLE_MINUTES = 30;

const TIME_OF_DAY = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  // Pinned for the same reason as `activity.ts`'s MONTH_DAY: the division is in
  // Manila, and an unpinned formatter renders a different clock time depending on
  // where the server runs — which would also make the test for this flaky.
  timeZone: "Asia/Manila",
});

/**
 * Which existing feed kind an ungrouped row renders as, so it keeps the icon it
 * has today. Only a grouped session uses the new `"session"` kind. A removal
 * shows its subject's icon — the sentence, not the glyph, says it was removed.
 */
const UNGROUPED_KIND: Record<ActivityEventKind, ActivityKind> = {
  "participant-added": "participant",
  "participant-removed": "participant",
  "coach-added": "coach",
  "coach-removed": "coach",
  "entry-submitted": "entry",
  "entry-withdrawn": "entry",
  "paper-updated": "paper-update",
  "paper-answered": "paper-answer",
  "submission-locked": "submission-lock",
};

/**
 * Where a single event points. Unfiltered lists, unlike `activity-source.ts`'s
 * `?school=<id>` links: a {@link SessionEvent} carries no school id, and deriving
 * a filter from the school *name* would hand the page a parameter it ignores.
 */
const KIND_HREF: Record<ActivityEventKind, string> = {
  "participant-added": "/admin/participants",
  "participant-removed": "/admin/participants",
  "coach-added": "/admin/coaches",
  "coach-removed": "/admin/coaches",
  "entry-submitted": "/admin/entries",
  "entry-withdrawn": "/admin/entries",
  "paper-updated": "/admin/school-papers",
  "paper-answered": "/admin/school-papers",
  "submission-locked": "/admin/school-papers",
};

/** What a title says instead of a blank school name, via the feed's one blank guard. */
const SCHOOL_FALLBACK = "A school";

/**
 * "5 learners", "1 learner", "5+ learners".
 *
 * A local copy of `timeline.ts`'s private `count()` rather than a shared import:
 * that helper is not exported and that file is owned elsewhere. `atLeast` forces
 * the plural, because the true figure is unknown and larger than `n` — "1+
 * learner" would claim a precision the cap destroyed.
 */
function count(n: number, singular: string, plural: string, atLeast: boolean): string {
  return `${atLeast ? `${n}+` : n} ${!atLeast && n === 1 ? singular : plural}`;
}

/** "a", "a and b", "a, b and c" — the noun list inside one predicate. */
function joinNouns(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Join whole predicates: "added 1 learner and locked its submissions".
 *
 * The connector before the last predicate becomes ", and " as soon as any
 * predicate carries its own "and", because without that comma "added 5 learners,
 * 5 coaches and entry for 6 events and locked its submissions" reads as a
 * four-item list of things that were added.
 */
function joinPredicates(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const connector = parts.some((part) => part.includes(" and ")) ? ", and " : " and ";
  return `${parts.slice(0, -1).join(", ")}${connector}${parts[parts.length - 1]}`;
}

/**
 * The sentence a session renders as: "Bagong Silang ES added 5 learners, 5
 * coaches and entry for 6 events".
 *
 * `atLeast` is set when the session's event fetch hit its cap, so every figure
 * reads "5+": a capped session must never state an exact number it does not
 * have. Entries are phrased by the events they cover rather than counted as
 * rows, because "6 entries" and "entry for 6 events" are the same fact and the
 * second is the one a coordinator works in.
 *
 * No trailing period — these titles sit in the same list as "Entry submitted —
 * Editorial Writing", and that source writes none.
 */
export function describeSession(counts: KindCounts, school: string, atLeast: boolean): string {
  const tally = (kind: ActivityEventKind) => counts[kind] ?? 0;
  const name = personLabel(school, SCHOOL_FALLBACK);

  const added: string[] = [];
  if (tally("participant-added") > 0) {
    added.push(count(tally("participant-added"), "learner", "learners", atLeast));
  }
  if (tally("coach-added") > 0) {
    added.push(count(tally("coach-added"), "coach", "coaches", atLeast));
  }
  if (tally("entry-submitted") > 0) {
    // One row per entry and an entry belongs to one event, so the row count *is*
    // the event count. "entry for 6 events" is the requirement's own wording and
    // it is the right English too: the plural belongs on "events", the noun that
    // actually varies, while entry reads as a mass noun the way "entry closes on
    // Friday" does.
    const events = tally("entry-submitted");
    added.push(`entry for ${count(events, "event", "events", atLeast)}`);
  }

  const removed: string[] = [];
  if (tally("participant-removed") > 0) {
    removed.push(count(tally("participant-removed"), "learner", "learners", atLeast));
  }
  if (tally("coach-removed") > 0) {
    removed.push(count(tally("coach-removed"), "coach", "coaches", atLeast));
  }

  const predicates: string[] = [];
  if (added.length > 0) predicates.push(`added ${joinNouns(added)}`);
  if (removed.length > 0) predicates.push(`removed ${joinNouns(removed)}`);
  if (tally("entry-withdrawn") > 0) {
    // "removed 1 entry" is what the row says; "withdrew" is what it means, and it
    // keeps deleted people and deleted entries in predicates of their own instead
    // of one list mixing learners with events.
    predicates.push(`withdrew ${count(tally("entry-withdrawn"), "entry", "entries", atLeast)}`);
  }
  if (tally("paper-updated") > 0) predicates.push("updated its school paper");
  if (tally("paper-answered") > 0) predicates.push("answered the school paper question");
  if (tally("submission-locked") > 0) predicates.push("locked its submissions");

  // Grouping never reaches this branch: a session exists only because it wrote
  // something. It stays because the function is total, and a caller holding an
  // empty tally deserves a sentence rather than a school name on its own.
  if (predicates.length === 0) return `${name} made no recorded changes`;

  return `${name} ${joinPredicates(predicates)}`;
}

interface Group {
  sessionId: string;
  schoolName: string;
  startedAt: number;
  endedAt: number;
  /** The latest event's timestamp, kept unparsed so the item carries the source string. */
  endedAtRaw: string;
  events: number;
  /** The kind of the first event seen, which is the only kind when `events === 1`. */
  firstKind: ActivityEventKind;
  counts: MutableKindCounts;
}

/**
 * Group the events into one item per session, merge them with the pre-cutoff
 * rows, and report whether anything was held back.
 */
export function groupActivitySessions(input: SessionInput): ActivityFeed {
  const idleMs = (input.idleMinutes ?? DEFAULT_IDLE_MINUTES) * 60_000;
  const nowMs = input.now.getTime();

  const groups = new Map<string, Group>();
  const ungrouped: ActivityItem[] = [];

  for (const event of input.events) {
    const at = Date.parse(event.at);
    // Dropped here rather than left to the merge's own filter. Inside a group a
    // NaN would poison min/max and take the whole session out of the feed, so one
    // unreadable timestamp would silently delete nine good rows with it.
    if (!Number.isFinite(at)) continue;

    const sessionId = (event.sessionId ?? "").trim();
    if (sessionId === "") {
      // The write carried no `session_id` claim — a seeder, an admin script, the
      // SQL console. Rendered as itself under design §4: do not guess which
      // session it belonged to.
      ungrouped.push({
        id: `${event.kind}:${event.id}`,
        kind: UNGROUPED_KIND[event.kind],
        at: event.at,
        title: describeSession(singleTally(event.kind), event.schoolName, false),
        meta: joinMeta(event.label),
        href: KIND_HREF[event.kind],
      });
      continue;
    }

    const existing = groups.get(sessionId);
    if (!existing) {
      groups.set(sessionId, {
        sessionId,
        schoolName: event.schoolName,
        startedAt: at,
        endedAt: at,
        endedAtRaw: event.at,
        events: 1,
        firstKind: event.kind,
        counts: singleTally(event.kind),
      });
      continue;
    }

    existing.events += 1;
    existing.counts[event.kind] = (existing.counts[event.kind] ?? 0) + 1;
    if (at < existing.startedAt) existing.startedAt = at;
    if (at > existing.endedAt) {
      existing.endedAt = at;
      existing.endedAtRaw = event.at;
      // The latest event names the session too, so one that began before a school
      // was renamed is titled with the name in force when it ended.
      existing.schoolName = event.schoolName;
    }
  }

  const ordered = [...groups.values()];

  // INVARIANT: one school is one actor. `SessionEvent` carries no
  // `actor_user_id`, and a school has exactly one auth user, so design §2's "a
  // newer session_id exists for the same actor" is evaluated over the school
  // name. Being wrong here only mislabels a session "In progress"; it cannot
  // change what the feed contains or the order it comes back in.
  const newestPerSchool = new Map<string, number>();
  for (const group of ordered) {
    const seen = newestPerSchool.get(group.schoolName) ?? Number.NEGATIVE_INFINITY;
    if (group.endedAt > seen) newestPerSchool.set(group.schoolName, group.endedAt);
  }

  const sessionItems: ActivityItem[] = ordered.map((group) => {
    const superseded = (newestPerSchool.get(group.schoolName) ?? group.endedAt) > group.endedAt;
    const idle = nowMs - group.endedAt > idleMs;
    // Idle never *splits* a group (design §2): one session_id stays one row even
    // if the tab lived for days. It only decides this label.
    const open = !superseded && !idle;
    const atLeast = input.capped.has(group.sessionId);

    const started = TIME_OF_DAY.format(group.startedAt);
    const ended = TIME_OF_DAY.format(group.endedAt);

    return {
      id: `session:${group.sessionId}`,
      kind: "session",
      // The LATEST event, not the earliest. Ordering on the start time buries a
      // session still being worked in under one that opened later and did less.
      at: group.endedAtRaw,
      title: describeSession(group.counts, group.schoolName, atLeast),
      meta: open
        ? `In progress · since ${started}`
        : started === ended
          ? started
          : `${started} to ${ended}`,
      // No session detail page exists, so only a session of exactly one event has
      // anywhere honest to point.
      href: group.events === 1 ? KIND_HREF[group.firstKind] : null,
    };
  });

  // `mergeActivityFeed` unchanged, and `session:` shares no prefix with `entry:`,
  // `participant:` or `coach:`, so its id tie-break stays total and two renders of
  // the same data are byte-identical.
  const merged = mergeActivityFeed([[...sessionItems, ...ungrouped], input.legacy], input.limit);

  const cap = Math.max(0, Math.floor(input.limit));
  return {
    items: merged.items,
    // Four things can hide something, and `false` may only mean none of them did:
    // the merge slicing at the limit and the legacy source arriving full (both
    // already decided by `mergeActivityFeed`), the probe seeing more sessions than
    // the limit, and a session whose own event fetch was capped — which hides no
    // row from the list but makes a tally a floor, so the feed still is not the
    // whole story.
    //
    // The merge's "a source came back holding `limit` rows" heuristic counts rows
    // where this source counts sessions, so it can over-report. That is the safe
    // direction: a feed wrongly labelled incomplete understates itself, while a
    // wrongly complete one lies.
    truncated:
      merged.truncated ||
      input.sessionsProbed > cap ||
      ordered.some((group) => input.capped.has(group.sessionId)),
  };
}

/** A one-event tally. Built by assignment because a computed key over a union widens. */
function singleTally(kind: ActivityEventKind): MutableKindCounts {
  const counts: MutableKindCounts = {};
  counts[kind] = 1;
  return counts;
}
