import { cache } from "react";

import { requireAdmin } from "@/app/admin/guard";
import {
  joinMeta,
  mergeActivityFeed,
  personLabel,
  type ActivityFeed,
} from "@/lib/dashboard/activity";
import {
  attentionBadge,
  buildAttention,
  type AttentionInput,
  type AttentionItem,
} from "@/lib/dashboard/attention";
import { buildKpis, type Kpi } from "@/lib/dashboard/kpis";
import {
  summarisePerEvent,
  type EventTypeCount,
  type PerEventSummary,
} from "@/lib/dashboard/per-event";
import {
  summarisePerSchool,
  type PerSchoolSummary,
  type SchoolRollupRow,
} from "@/lib/dashboard/per-school";
import { buildTimeline, type Timeline } from "@/lib/dashboard/timeline";
import {
  LANGUAGE_LABEL,
  type EventCategory,
  type EventLanguage,
  type EventLevel,
} from "@/lib/events-catalog";
import type { PaperParticipation } from "@/lib/paper/gate";
import { paperStatus } from "@/lib/paper/status";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirst } from "@/lib/roster/names";

/** Rows on screen in the Per School Summary panel. The totals row still sums all of them. */
const PER_SCHOOL_LIMIT = 15;
/** Donut slices before the rest folds into "Other". */
const DONUT_TOP_N = 8;
/**
 * Rows pulled from each activity source. Six sources, then merged and cut to
 * ACTIVITY_SHOWN.
 *
 * Fetching more per source than the feed shows is deliberate and is the safe
 * direction of mergeActivityFeed()'s invariant: merging to *more* rows than each
 * source fetched would let one source's exhausted page masquerade as the global
 * newest. Do not lower it below ACTIVITY_SHOWN.
 */
const ACTIVITY_FETCH_LIMIT = 8;
/** Rows the feed shows. */
const ACTIVITY_SHOWN = 5;

/**
 * `lib/events-catalog.ts` exports `levelTag()` — "elem" / "sec", for building event
 * codes — but no prose label, so this file owns one. It is not exported: the catalog
 * stays the single source of truth for event data, and this is presentation.
 */
const LEVEL_LABEL: Record<EventLevel, string> = {
  elementary: "Elementary",
  secondary: "Secondary",
};

export interface EventOption {
  id: string;
  label: string;
}

export interface EventOptionGroup {
  typeId: string;
  typeName: string;
  options: EventOption[];
}

export interface ShellFacts {
  adminName: string;
  attentionBadge: number;
}

export interface DashboardData {
  /** One instant for the whole response, so no two panels disagree about "now". */
  now: Date;
  adminName: string;
  kpis: Kpi[];
  perSchool: PerSchoolSummary;
  perEvent: PerEventSummary;
  attention: AttentionItem[];
  /**
   * The feed *and* whether anything was held back — not a bare `ActivityItem[]`.
   * Six sources capped at ACTIVITY_FETCH_LIMIT merged down to ACTIVITY_SHOWN means
   * the feed is always truncated in production, so the flag travels with the items
   * rather than being dropped here and re-guessed by the panel.
   */
  activity: ActivityFeed;
  timeline: Timeline;
  eventGroups: EventOptionGroup[];
}

/**
 * The request's admin-guarded Supabase client.
 *
 * cache() is doing real work here: the dashboard page and the shell's topbar both need
 * this, and without it each would run its own auth round trip and its own
 * admin_profiles lookup. No arguments is deliberate — cache() keys on arguments, and a
 * client passed in as a parameter would be a different object in each caller.
 *
 * requireAdmin() redirects a non-admin to /admin/login, so every loader below is
 * unreachable without an admin session. RLS is still the thing that actually protects
 * the rows; this is the redirect, not the wall.
 *
 * Every query in this file is a select. Nothing here writes, and nothing here calls a
 * function that writes.
 */
export const getAdminClient = cache(async () => (await requireAdmin()).supabase);

/**
 * The signed-in admin's name for the topbar chip.
 *
 * No `.eq("user_id", …)`: the "self read admin_profiles" policy already restricts this
 * table to `user_id = auth.uid()`, so an unfiltered select returns exactly the caller's
 * own row. Skipping the filter also skips fetching the user id to filter by.
 */
export const loadAdminName = cache(async (): Promise<string> => {
  const supabase = await getAdminClient();
  const { data } = await supabase
    .from("admin_profiles")
    .select("full_name")
    .limit(1)
    .maybeSingle()
    .overrideTypes<{ full_name: string | null }>();

  return data?.full_name?.trim() || "Division Admin";
});

interface SchoolFactRow {
  id: string;
  name: string;
  district_id: string | null;
  paper_participation: PaperParticipation;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  participants: { count: number }[];
  coaches: { count: number }[];
  entries: { count: number }[];
  school_papers: { count: number }[];
}

interface SchoolFacts {
  /**
   * Every school that has engaged with the system at all, ranked by the panel. See
   * the union in the loader for what "engaged" means and why it is four tables.
   */
  active: SchoolRollupRow[];
  registeredSchools: number;
  schoolsWithEntries: number;
  districtsRegistered: number;
  districtsWithEntries: number;
  schoolsLocked: number;
  schoolsOpenWithEntries: number;
  schoolsPaperNotStarted: number;
  schoolsWithLearnersButNoEntry: number;
}

/**
 * One query, nine facts. Each `(count)` is an embedded aggregate, which PostgREST
 * returns as a one-element array — the same shape `/admin/entries` already unwraps for
 * its `school_papers(count)`.
 *
 * The 332 rows are filtered in JavaScript because PostgREST cannot filter or order on
 * an embedded aggregate: `participants(count) > 0` is not expressible as a query. One
 * request for 332 narrow rows is cheaper than the alternatives.
 *
 * `count: "exact"` rides along on the same request. `registeredSchools` comes from that
 * header total rather than from `rows.length`, so the "of N registered" denominator
 * stays right even if PostgREST's row cap ever truncated the window.
 */
export const loadSchoolFacts = cache(async (): Promise<SchoolFacts> => {
  const supabase = await getAdminClient();
  const { data, count } = await supabase
    .from("schools")
    .select(
      "id, name, district_id, paper_participation, submission_locked_at, districts(name), participants(count), coaches(count), entries(count), school_papers(count)",
      { count: "exact" }
    )
    .order("name")
    .overrideTypes<SchoolFactRow[]>();

  const rows = (data ?? []).map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    districtId: row.district_id,
    districtName: row.districts?.name ?? "",
    learners: row.participants?.[0]?.count ?? 0,
    coaches: row.coaches?.[0]?.count ?? 0,
    entries: row.entries?.[0]?.count ?? 0,
    paperCount: row.school_papers?.[0]?.count ?? 0,
    participation: row.paper_participation,
    lockedAt: row.submission_locked_at,
  }));

  const withEntries = rows.filter((row) => row.entries > 0);

  return {
    // "Engaged" is the union of four tables, not one table as a proxy for the rest.
    // Entries, participants, coaches and school_papers overlap without coinciding:
    // measured against production today, 39 schools are engaged and 2 of them reach
    // that set through school_papers alone. This filter *is* the panel's
    // "N of 332 schools" line — summarisePerSchool() takes `active.length` verbatim
    // and does no filtering of its own — so dropping school_papers here would quietly
    // understate engagement. A paper-only school contributes 0 to all three numeric
    // columns, so no total moves; only the school count does.
    active: rows
      .filter(
        (row) =>
          row.learners > 0 || row.coaches > 0 || row.entries > 0 || row.paperCount > 0
      )
      .map(({ schoolId, schoolName, districtName, learners, coaches, entries }) => ({
        schoolId,
        schoolName,
        districtName,
        learners,
        coaches,
        entries,
      })),
    registeredSchools: count ?? rows.length,
    schoolsWithEntries: withEntries.length,
    // A school with no district still counts as registered, so the id is only
    // deduplicated where it exists.
    districtsRegistered: new Set(rows.map((row) => row.districtId).filter(Boolean)).size,
    districtsWithEntries: new Set(withEntries.map((row) => row.districtId).filter(Boolean))
      .size,
    schoolsLocked: rows.filter((row) => row.lockedAt !== null).length,
    // The number buildTimeline() needs: a school still holding the door open on real
    // work. A locked school with no entries does not keep registration open, and an
    // unlocked school with no entries has nothing to submit.
    schoolsOpenWithEntries: rows.filter((row) => row.entries > 0 && row.lockedAt === null)
      .length,
    // paperStatus() is the same derivation /admin/school-papers filters on, so this
    // count and `?status=incomplete` cannot disagree: `paperCount < 1` there is a
    // distinct-language set, and no rows means no languages either way.
    schoolsPaperNotStarted: rows.filter(
      (row) =>
        paperStatus({
          participation: row.participation,
          paperCount: row.paperCount,
          lockedAt: row.lockedAt,
        }) === "incomplete"
    ).length,
    schoolsWithLearnersButNoEntry: rows.filter((row) => row.learners > 0 && row.entries === 0)
      .length,
  };
});

interface RosterFacts {
  participants: number;
  participantsWithoutEntry: number;
  coaches: number;
  coachesWithoutEntry: number;
}

/**
 * The two roster totals and how many of each are on no entry.
 *
 * Four counts, four `head: true` requests, no rows transferred. "Without an entry" is a
 * set difference, and the tempting way to get it is to fetch every `entry_participants`
 * row and count distinct ids — but PostgREST caps a rowset, that link table already
 * holds ~620 rows against a roster of ~720, and a `.length` over a capped window
 * under-reports silently as the competition grows. `!inner` turns the same question
 * into a count the database answers: an inner-joined embed keeps one top-level row per
 * roster member with at least one link, so the count *is* the number entered.
 * Verified against production: both spellings return the same number today
 * (603 of 721 learners, 161 of 178 coaches).
 */
export const loadRosterFacts = cache(async (): Promise<RosterFacts> => {
  const supabase = await getAdminClient();
  const [
    { count: participants },
    { count: participantsEntered },
    { count: coaches },
    { count: coachesEntered },
  ] = await Promise.all([
    supabase.from("participants").select("*", { count: "exact", head: true }),
    supabase
      .from("participants")
      .select("id, entry_participants!inner(participant_id)", {
        count: "exact",
        head: true,
      }),
    supabase.from("coaches").select("*", { count: "exact", head: true }),
    supabase
      .from("coaches")
      .select("id, entry_coaches!inner(coach_id)", { count: "exact", head: true }),
  ]);

  const participantsTotal = participants ?? 0;
  const coachesTotal = coaches ?? 0;

  return {
    participants: participantsTotal,
    // Clamped at zero: these are four separate requests against a live database, so a
    // roster row inserted between two of them must not produce a negative count on a
    // KPI tile.
    participantsWithoutEntry: Math.max(0, participantsTotal - (participantsEntered ?? 0)),
    coaches: coachesTotal,
    coachesWithoutEntry: Math.max(0, coachesTotal - (coachesEntered ?? 0)),
  };
});

/**
 * The four counts behind the attention list and the topbar badge.
 *
 * It reads no rows of its own — both loaders it calls are cached, so on the dashboard
 * this is pure arithmetic over data the page already fetched.
 */
export const loadAttentionInput = cache(async (): Promise<AttentionInput> => {
  const [schools, roster] = await Promise.all([loadSchoolFacts(), loadRosterFacts()]);

  return {
    learnersWithoutEntry: roster.participantsWithoutEntry,
    schoolsWithLearnersButNoEntry: schools.schoolsWithLearnersButNoEntry,
    coachesWithoutEntry: roster.coachesWithoutEntry,
    schoolsPaperNotStarted: schools.schoolsPaperNotStarted,
  };
});

/** What the shell's topbar needs on every admin page. */
export const loadShellFacts = cache(async (): Promise<ShellFacts> => {
  const [adminName, attention] = await Promise.all([loadAdminName(), loadAttentionInput()]);

  return { adminName, attentionBadge: attentionBadge(buildAttention(attention)) };
});

interface EventFactRow {
  id: string;
  name: string;
  level: EventLevel;
  language: EventLanguage;
  category: EventCategory;
  event_type_id: string;
  /** Entries filed in this one event slot, division-wide. */
  entries: { count: number }[];
}

/**
 * The 56 event slots the division runs, each carrying its own entry count.
 *
 * This is the seam that keeps entry arithmetic off the `entries` table. Counting
 * entries by fetching every `entries` row and taking `.length` works today at ~325
 * rows and stops working silently at PostgREST's row cap; an embedded `(count)` is
 * computed in Postgres, so it is exact however large the competition gets. 56 is fixed
 * by the seeded catalog, and `entries.event_id` is NOT NULL with a foreign key to this
 * table, so summing these counts is the total — no entry can sit outside the sum.
 *
 * Private on purpose: `loadEntryFacts` and `loadEventFacts` are the two facts callers
 * want, and both derive from this one cached request rather than querying twice.
 */
const loadEventRows = cache(async (): Promise<EventFactRow[]> => {
  const supabase = await getAdminClient();
  const { data } = await supabase
    .from("events")
    .select("id, name, level, language, category, event_type_id, entries(count)")
    .order("sort_order")
    .overrideTypes<EventFactRow[]>();

  return data ?? [];
});

interface EntryFacts {
  entries: number;
  entriesIndividual: number;
  entriesGroup: number;
  /** event_type_id -> entry count. The donut's raw material. */
  byType: Map<string, number>;
}

/**
 * The Total Entries tile, its individual/group subtitle, and every donut slice — all
 * from the one 56-row read above, so the headline and its subtitle cannot come from
 * two requests that saw different data.
 */
export const loadEntryFacts = cache(async (): Promise<EntryFacts> => {
  const events = await loadEventRows();

  const byType = new Map<string, number>();
  let entries = 0;
  let entriesIndividual = 0;
  let entriesGroup = 0;

  for (const event of events) {
    const count = event.entries?.[0]?.count ?? 0;
    if (count === 0) continue;

    entries += count;
    if (event.category === "individual") entriesIndividual += count;
    else if (event.category === "group") entriesGroup += count;
    byType.set(event.event_type_id, (byType.get(event.event_type_id) ?? 0) + count);
  }

  return { entries, entriesIndividual, entriesGroup, byType };
});

interface EventTypeFactRow {
  id: string;
  name_en: string;
}

interface EventFacts {
  counts: EventTypeCount[];
  typesTotal: number;
  typesContested: number;
  groups: EventOptionGroup[];
}

/**
 * The event catalog as the dashboard needs it: one count per type for the donut, and
 * the 56 individual events grouped by type for the Registration card's select.
 *
 * The grouping is not cosmetic. `events.name` carries only the event's name — the same
 * string for all four level/language variants of a type — so a flat list would show
 * "Editorial Writing" four times with no way to tell them apart.
 */
export const loadEventFacts = cache(async (): Promise<EventFacts> => {
  const supabase = await getAdminClient();
  const [{ data: types }, eventRows, entryFacts] = await Promise.all([
    supabase
      .from("event_types")
      .select("id, name_en")
      .order("sort_order")
      .overrideTypes<EventTypeFactRow[]>(),
    loadEventRows(),
    loadEntryFacts(),
  ]);

  const typeRows = types ?? [];

  const counts: EventTypeCount[] = typeRows.map((type) => ({
    typeId: type.id,
    typeName: type.name_en,
    entries: entryFacts.byType.get(type.id) ?? 0,
  }));

  const groups: EventOptionGroup[] = typeRows
    .map((type) => ({
      typeId: type.id,
      typeName: type.name_en,
      options: eventRows
        .filter((event) => event.event_type_id === type.id)
        .map((event) => ({
          id: event.id,
          // The event name repeats inside its own group heading on purpose: Radix
          // renders the selected item's own text in the closed trigger, where
          // "Elementary · English" alone would not say which event was picked.
          label: `${event.name} · ${LEVEL_LABEL[event.level]} · ${LANGUAGE_LABEL[event.language]}`,
        })),
    }))
    // A type with no seeded events would otherwise render an empty group heading.
    .filter((group) => group.options.length > 0);

  return {
    counts,
    typesTotal: typeRows.length,
    typesContested: counts.filter((count) => count.entries > 0).length,
    groups,
  };
});

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
 * Six sources, each already ordered newest-first and capped, merged by
 * mergeActivityFeed() into one feed that also reports whether anything was held back.
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
export const loadActivity = cache(async (): Promise<ActivityFeed> => {
  const supabase = await getAdminClient();
  const [entries, participants, coaches, answers, locks, papers] = await Promise.all([
    supabase
      .from("entries")
      .select("id, submitted_at, school_id, schools(name), events(name)")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<EntryActivityRow[]>(),
    supabase
      .from("participants")
      .select(
        "id, participant_number, first_name, middle_name, last_name, created_at, school_id, schools(name)"
      )
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<ParticipantActivityRow[]>(),
    supabase
      .from("coaches")
      .select("id, first_name, middle_name, last_name, created_at, schools(name)")
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<CoachActivityRow[]>(),
    supabase
      .from("schools")
      .select("id, name, paper_participation, paper_answered_at")
      .not("paper_answered_at", "is", null)
      .order("paper_answered_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<PaperAnswerActivityRow[]>(),
    supabase
      .from("schools")
      .select("id, name, submission_locked_at")
      .not("submission_locked_at", "is", null)
      .order("submission_locked_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<LockActivityRow[]>(),
    supabase
      .from("school_papers")
      .select("id, paper_name, updated_at, schools(name)")
      .order("updated_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<PaperUpdateActivityRow[]>(),
  ]);

  return mergeActivityFeed(
    [
      (entries.data ?? []).map((row) => ({
        id: `entry:${row.id}`,
        kind: "entry" as const,
        at: row.submitted_at,
        title: `Entry submitted — ${row.events?.name ?? "event"}`,
        meta: joinMeta(row.schools?.name),
        href: `/admin/entries?school=${row.school_id}`,
      })),
      (participants.data ?? []).map((row) => ({
        id: `participant:${row.id}`,
        kind: "participant" as const,
        at: row.created_at,
        title: `Learner added — ${formatParticipantNumber(row.participant_number)} ${personLabel(
          surnameFirst(row)
        )}`,
        meta: joinMeta(row.schools?.name),
        href: `/admin/participants?school=${row.school_id}`,
      })),
      (coaches.data ?? []).map((row) => ({
        id: `coach:${row.id}`,
        kind: "coach" as const,
        at: row.created_at,
        title: `Coach added — ${personLabel(surnameFirst(row))}`,
        meta: joinMeta(row.schools?.name),
        // /admin/coaches has no school filter to link into, so this lands on the
        // unfiltered list rather than on a parameter the page would ignore.
        href: "/admin/coaches",
      })),
      (answers.data ?? []).map((row) => ({
        id: `paper-answer:${row.id}`,
        kind: "paper-answer" as const,
        at: row.paper_answered_at,
        title: `${row.name} answered the school paper question`,
        meta: PARTICIPATION_LABEL[row.paper_participation],
        href: "/admin/school-papers",
      })),
      (locks.data ?? []).map((row) => ({
        id: `submission-lock:${row.id}`,
        kind: "submission-lock" as const,
        at: row.submission_locked_at,
        title: `${row.name} locked its submissions`,
        meta: "No further changes from the school",
        href: "/admin/school-papers",
      })),
      (papers.data ?? []).map((row) => ({
        id: `paper-update:${row.id}`,
        kind: "paper-update" as const,
        at: row.updated_at,
        title: `School paper updated — ${row.paper_name?.trim() || "untitled"}`,
        meta: joinMeta(row.schools?.name),
        href: "/admin/school-papers",
      })),
    ],
    ACTIVITY_SHOWN
  );
});

/** Everything the overview page renders, in one call. */
export const loadDashboardData = cache(async (): Promise<DashboardData> => {
  const [schools, roster, entryFacts, events, activity, attentionInput, adminName] =
    await Promise.all([
      loadSchoolFacts(),
      loadRosterFacts(),
      loadEntryFacts(),
      loadEventFacts(),
      loadActivity(),
      loadAttentionInput(),
      loadAdminName(),
    ]);

  return {
    now: new Date(),
    adminName,
    kpis: buildKpis({
      schoolsRegistered: schools.registeredSchools,
      schoolsWithEntries: schools.schoolsWithEntries,
      participants: roster.participants,
      participantsWithoutEntry: roster.participantsWithoutEntry,
      coaches: roster.coaches,
      coachesWithoutEntry: roster.coachesWithoutEntry,
      entries: entryFacts.entries,
      entriesIndividual: entryFacts.entriesIndividual,
      entriesGroup: entryFacts.entriesGroup,
      eventTypes: events.typesTotal,
      eventTypesContested: events.typesContested,
      districtsRegistered: schools.districtsRegistered,
      districtsWithEntries: schools.districtsWithEntries,
    }),
    perSchool: summarisePerSchool(schools.active, {
      limit: PER_SCHOOL_LIMIT,
      registeredSchools: schools.registeredSchools,
    }),
    perEvent: summarisePerEvent(events.counts, {
      topN: DONUT_TOP_N,
      typesTotal: events.typesTotal,
    }),
    attention: buildAttention(attentionInput),
    activity,
    timeline: buildTimeline({
      schoolsLocked: schools.schoolsLocked,
      schoolsOpenWithEntries: schools.schoolsOpenWithEntries,
      entries: entryFacts.entries,
    }),
    eventGroups: events.groups,
  };
});
