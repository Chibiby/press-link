import {
  joinMeta,
  personLabel,
  type ActivityFeed,
  type ActivityItem,
} from "@/lib/dashboard/activity";
import {
  groupActivitySessions,
  type ActivityEventKind,
  type SessionEvent,
} from "@/lib/dashboard/activity-sessions";
import type { PaperParticipation } from "@/lib/paper/gate";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirst } from "@/lib/roster/names";
import { isMissingLockGuard } from "@/lib/submissions/lock-state";
import type { SupabaseServerClient } from "@/lib/supabase/server";

interface EntryActivityRow {
  id: string;
  submitted_at: string;
  school_id: string;
  schools: { name: string } | null;
  events: { name: string } | null;
}

interface ParticipantActivityRow {
  id: string;
  participant_number: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  created_at: string;
  school_id: string;
  schools: { name: string } | null;
}

interface CoachActivityRow {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  created_at: string;
  schools: { name: string } | null;
}

interface PaperAnswerActivityRow {
  id: string;
  name: string;
  paper_participation: PaperParticipation;
  paper_answered_at: string;
}

interface LockActivityRow {
  id: string;
  name: string;
  submission_locked_at: string;
}

interface PaperUpdateActivityRow {
  id: string;
  paper_name: string | null;
  updated_at: string;
  schools: { name: string } | null;
}

/** One row of `recent_activity_sessions(p_limit int)`. */
interface SessionProbeRow {
  session_id: string | null;
  last_at: string | null;
}

/** One `activity_events` row as selected here. */
interface ActivityEventRow {
  id: string;
  at: string;
  session_id: string | null;
  school_id: string | null;
  kind: ActivityEventKind;
  label: string | null;
  schools: { name: string } | null;
}

/**
 * What the session layer managed to read.
 *
 * `available: false` is the pre-migration answer and carries no events, no capped
 * ids and no probed count, so {@link groupActivitySessions} receives exactly the
 * inputs that reduce it to today's six-source merge.
 */
interface SessionRead {
  events: SessionEvent[];
  capped: Set<string>;
  sessionsProbed: number;
  available: boolean;
}

/**
 * What a school said when it answered the contest question — an answer, not a state of
 * participation. 12 schools have answered "yes" against 295 still undecided, so
 * wording this as "is participating" would read as a division-wide tally and be wrong
 * by several times over.
 */
const PARTICIPATION_LABEL: Record<PaperParticipation, string> = {
  yes: "Joining the school paper contest",
  no: "Not joining the school paper contest",
  undecided: "Answered, still undecided",
};

/**
 * The most `activity_events` rows fetched for one session.
 *
 * A ceiling rather than the feed's `limit`, because the row a reader sees is a
 * tally: cutting a session's events short turns "added 9 learners" into "added 3"
 * with nothing to say it lied. A session that reaches this is recorded in `capped`
 * instead, and its sentence says "at least".
 */
const SESSION_EVENT_CAP = 500;

const EVENT_COLUMNS = "id, at, session_id, school_id, kind, label, schools(name)";

/**
 * Fail soft, and never any other way.
 *
 * Migrations 0024 and 0025 are not applied, so `activity_events`,
 * `recent_activity_sessions()` and `app_settings.activity_log_started_at` are all
 * absent on the database this branch deploys to. Every read below degrades to
 * today's behaviour — the six legacy sources, ungated — and MUST NOT later be
 * hardened into a throw: the activity panel disappearing is a worse outcome than a
 * feed that has not learned about sessions yet.
 *
 * `isMissingLockGuard()` is reused rather than re-listed. Its name says lock, but
 * the set it holds is the "this object is not on this database" set, in both
 * dialects that reach the client: an unmigrated Supabase project answers from its
 * schema cache (`PGRST205`/`PGRST202`/`PGRST204`) and never reaches Postgres,
 * while a direct statement answers with the SQLSTATE instead. A second copy of
 * that list would be a second answer to one question.
 */
function isNotMigrated(code: string | null | undefined): boolean {
  return isMissingLockGuard(code);
}

/** No session layer: the inputs that make the grouped feed equal to the legacy one. */
function noSessions(): SessionRead {
  return { events: [], capped: new Set<string>(), sessionsProbed: 0, available: false };
}

function parsedAt(at: string | null): number {
  const value = Date.parse(at ?? "");
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function toSessionEvent(row: ActivityEventRow): SessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    at: row.at,
    // The join is nullable — a school row can go while its events stay — and the
    // school name is the subject of the sentence, so it cannot be blank.
    schoolName: personLabel(row.schools?.name, "A school"),
    kind: row.kind,
    label: row.label,
  };
}

/**
 * `at < activity_log_started_at`, or the query untouched when there is no cutoff.
 *
 * A helper rather than a ternary inside each of six chains, because six places to
 * forget the gate is five too many.
 */
function beforeCutoff<Query extends { lt(column: string, value: string): unknown }>(
  query: Query,
  column: string,
  cutoff: string | null
): Query {
  if (cutoff === null) return query;
  // `lt()` appends to the query's own search params and hands back `this`, so this
  // is the same builder. Asserted rather than declared as the constraint's return
  // type: `lt(): Query` makes the constraint self-referential and tsc gives up on
  // the PostgREST builder generics with TS2589 instead of checking the six chains.
  return query.lt(column, cutoff) as Query;
}

/**
 * When the event log took over, so the same action is not counted twice.
 *
 * Returns null — meaning "do not gate" — for every failure, including a row that
 * exists with a null cutoff. The two directions are not symmetric: an ungated
 * legacy feed can double-count an action that also has an event row, while gating
 * on a cutoff nobody could read would filter `at < null`, match nothing, and empty
 * the panel.
 */
async function readActivityCutoff(supabase: SupabaseServerClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("activity_log_started_at")
    .eq("id", true)
    .maybeSingle()
    .overrideTypes<{ activity_log_started_at: string | null }>();

  if (error) {
    // Not logged when the column is simply not there yet: that is true on every
    // render until 0024 lands, and a line per render would bury the real errors.
    if (!isNotMigrated(error.code)) console.error("fetchActivity.activityCutoff", error);
    return null;
  }

  return data?.activity_log_started_at ?? null;
}

/**
 * The session layer: probe for the recent session ids, then read their events.
 *
 * Two waves on purpose. The probe already returns `limit + 1` rows of its own so
 * the caller can tell "one more session exists" from "that is all of them", which
 * is why `limit` is passed through unchanged; the events are then read per session
 * so the 500 ceiling is per session and a session that hits it can be named in
 * `capped`. One `.in()` query with a shared ceiling could not: it would cut the
 * oldest rows of whichever session happened to own them, and no count would show
 * which session had been shortened.
 *
 * The `session_id is null` read is not an extra. `activity_events.session_id` is
 * stamped from a JWT claim this project does not set, so on this database every
 * event may well carry no session at all — then the probe returns no rows and
 * these are the only events there are. Dropping them would leave a gated legacy
 * feed showing pre-cutoff history and nothing since. They reach
 * `groupActivitySessions` as `sessionId: null`, which renders each on its own.
 */
async function readSessionActivity(
  supabase: SupabaseServerClient,
  limit: number
): Promise<SessionRead> {
  const cap = Math.max(0, Math.floor(limit));

  const probe = await supabase.rpc("recent_activity_sessions", { p_limit: cap });
  if (probe.error) {
    if (!isNotMigrated(probe.error.code)) console.error("fetchActivity.sessionProbe", probe.error);
    return noSessions();
  }

  const probed = (probe.data ?? []) as SessionProbeRow[];
  // Sorted here as well as in the RPC, because which sessions get read is decided
  // by this slice: taking the row order on trust would silently drop the newest
  // session if that order ever changed.
  const ids = probed
    .filter((row) => (row.session_id ?? "").trim() !== "")
    .sort((a, b) => parsedAt(b.last_at) - parsedAt(a.last_at))
    .slice(0, cap)
    .map((row) => (row.session_id ?? "").trim());

  const [ungrouped, ...perSession] = await Promise.all([
    supabase
      .from("activity_events")
      .select(EVENT_COLUMNS)
      .is("session_id", null)
      .order("at", { ascending: false })
      // One item each, and the merge keeps `limit` items, so the newest `limit` of
      // them is every one that could survive it.
      .limit(cap)
      .overrideTypes<ActivityEventRow[]>(),
    ...ids.map((id) =>
      supabase
        .from("activity_events")
        .select(EVENT_COLUMNS)
        .eq("session_id", id)
        .order("at", { ascending: false })
        .limit(SESSION_EVENT_CAP)
        .overrideTypes<ActivityEventRow[]>()
    ),
  ]);

  const failure = [ungrouped, ...perSession].find((result) => result.error)?.error;
  if (failure) {
    if (!isNotMigrated(failure.code)) console.error("fetchActivity.sessionEvents", failure);
    // All of it, not the part that answered: a half-read session tallies wrong, and
    // the legacy feed it falls back to already covers the same actions.
    return noSessions();
  }

  const events: SessionEvent[] = (ungrouped.data ?? []).map(toSessionEvent);
  const capped = new Set<string>();

  perSession.forEach((result, index) => {
    const rows = result.data ?? [];
    if (rows.length >= SESSION_EVENT_CAP) capped.add(ids[index]);
    for (const row of rows) events.push(toSessionEvent(row));
  });

  return { events, capped, sessionsProbed: probed.length, available: true };
}

/**
 * The activity feed: sessions from the event log, plus the six legacy timestamp
 * columns for everything that happened before the log existed.
 *
 * It takes its client rather than building one, because the dashboard and the activity
 * page guard identically but *size* differently. `limit` bounds sessions now rather
 * than rows — it goes to the probe, to the ungrouped read and to the merge — and
 * {@link groupActivitySessions} owns the merge, so no caller can pair a fetch size
 * with a different merge size.
 *
 * On the four nullable timestamps, `.not(column, "is", null)` is load-bearing rather
 * than defensive: Postgres sorts NULLs first on a descending order, so without it a
 * table full of unanswered schools would fill the whole page of results with rows that
 * have no timestamp to show. `entries.submitted_at` is `not null` (0001_init.sql:56),
 * so the guard there changes nothing today and is kept only so all six queries read
 * alike.
 *
 * Names go through personLabel(): `coaches.first_name` and `coaches.last_name` both
 * default to '' (0015_restore_coach_name_parts.sql), so surnameFirst() can legitimately
 * return an empty string and "Coach added — " is not a sentence. School names go
 * through joinMeta(), which yields null rather than an empty meta line.
 */
export async function fetchActivity(
  supabase: SupabaseServerClient,
  limit: number
): Promise<ActivityFeed> {
  const [cutoff, sessions] = await Promise.all([
    readActivityCutoff(supabase),
    readSessionActivity(supabase, limit),
  ]);

  // The gate and the session layer stand or fall together. A cutoff that reads on a
  // database whose events cannot be read would hide every action since the cutoff
  // from both halves of the feed; leaving it ungated only risks listing an action
  // twice, which is the failure a reader can see through.
  const gate = sessions.available ? cutoff : null;

  const [entries, participants, coaches, answers, locks, papers] = await Promise.all([
    beforeCutoff(
      supabase
        .from("entries")
        .select("id, submitted_at, school_id, schools(name), events(name)")
        .not("submitted_at", "is", null),
      "submitted_at",
      gate
    )
      .order("submitted_at", { ascending: false })
      .limit(limit)
      .overrideTypes<EntryActivityRow[]>(),
    beforeCutoff(
      supabase
        .from("participants")
        .select(
          "id, participant_number, first_name, middle_name, last_name, created_at, school_id, schools(name)"
        ),
      "created_at",
      gate
    )
      .order("created_at", { ascending: false })
      .limit(limit)
      .overrideTypes<ParticipantActivityRow[]>(),
    beforeCutoff(
      supabase
        .from("coaches")
        .select("id, first_name, middle_name, last_name, created_at, schools(name)"),
      "created_at",
      gate
    )
      .order("created_at", { ascending: false })
      .limit(limit)
      .overrideTypes<CoachActivityRow[]>(),
    beforeCutoff(
      supabase
        .from("schools")
        .select("id, name, paper_participation, paper_answered_at")
        .not("paper_answered_at", "is", null),
      "paper_answered_at",
      gate
    )
      .order("paper_answered_at", { ascending: false })
      .limit(limit)
      .overrideTypes<PaperAnswerActivityRow[]>(),
    beforeCutoff(
      supabase
        .from("schools")
        .select("id, name, submission_locked_at")
        .not("submission_locked_at", "is", null),
      "submission_locked_at",
      gate
    )
      .order("submission_locked_at", { ascending: false })
      .limit(limit)
      .overrideTypes<LockActivityRow[]>(),
    beforeCutoff(
      supabase.from("school_papers").select("id, paper_name, updated_at, schools(name)"),
      "updated_at",
      gate
    )
      .order("updated_at", { ascending: false })
      .limit(limit)
      .overrideTypes<PaperUpdateActivityRow[]>(),
  ]);

  const legacy: ActivityItem[] = [
    ...(entries.data ?? []).map((row) => ({
      id: `entry:${row.id}`,
      kind: "entry" as const,
      at: row.submitted_at,
      title: `Entry submitted — ${row.events?.name ?? "event"}`,
      meta: joinMeta(row.schools?.name),
      href: `/admin/entries?school=${row.school_id}`,
    })),
    ...(participants.data ?? []).map((row) => ({
      id: `participant:${row.id}`,
      kind: "participant" as const,
      at: row.created_at,
      title: `Learner added — ${formatParticipantNumber(row.participant_number)} ${personLabel(
        surnameFirst(row)
      )}`,
      meta: joinMeta(row.schools?.name),
      href: `/admin/participants?school=${row.school_id}`,
    })),
    ...(coaches.data ?? []).map((row) => ({
      id: `coach:${row.id}`,
      kind: "coach" as const,
      at: row.created_at,
      title: `Coach added — ${personLabel(surnameFirst(row))}`,
      meta: joinMeta(row.schools?.name),
      // /admin/coaches has no school filter to link into, so this lands on the
      // unfiltered list rather than on a parameter the page would ignore.
      href: "/admin/coaches",
    })),
    ...(answers.data ?? []).map((row) => ({
      id: `paper-answer:${row.id}`,
      kind: "paper-answer" as const,
      at: row.paper_answered_at,
      title: `${row.name} answered the school paper question`,
      meta: PARTICIPATION_LABEL[row.paper_participation],
      href: "/admin/school-papers",
    })),
    ...(locks.data ?? []).map((row) => ({
      id: `submission-lock:${row.id}`,
      kind: "submission-lock" as const,
      at: row.submission_locked_at,
      title: `${row.name} locked its submissions`,
      meta: "No further changes from the school",
      href: "/admin/school-papers",
    })),
    ...(papers.data ?? []).map((row) => ({
      id: `paper-update:${row.id}`,
      kind: "paper-update" as const,
      at: row.updated_at,
      title: `School paper updated — ${row.paper_name?.trim() || "untitled"}`,
      meta: joinMeta(row.schools?.name),
      href: "/admin/school-papers",
    })),
  ];

  return groupActivitySessions({
    events: sessions.events,
    capped: sessions.capped,
    legacy,
    sessionsProbed: sessions.sessionsProbed,
    limit,
    // The one clock read in the feed. The grouping function takes `now` injected so
    // it stays pure and two renders of the same data agree; this is the boundary
    // where a real timestamp has to enter, and both call sites are request-scoped
    // server renders.
    now: new Date(),
  });
}
