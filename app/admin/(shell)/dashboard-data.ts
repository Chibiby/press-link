import { cache } from "react";

import { requireAdmin } from "@/app/admin/guard";
import type { ActivityFeed } from "@/lib/dashboard/activity";
import { fetchActivity } from "@/lib/dashboard/activity-source";
import {
  buildAttention,
  type AttentionInput,
  type AttentionItem,
} from "@/lib/dashboard/attention";
import { buildKpis, type Kpi } from "@/lib/dashboard/kpis";
import {
  pendingJudgeReviewCount,
  type PendingRound,
  type PendingSheet,
} from "@/lib/judging/pending-review";
import {
  summarisePerEvent,
  type EventTypeCount,
  type PerEventSummary,
} from "@/lib/dashboard/per-event";
import {
  summarisePerSchool,
  type PerSchoolSummary,
} from "@/lib/dashboard/per-school";
import { fetchSchoolFacts, type SchoolFacts } from "@/lib/dashboard/school-facts";
import { buildTimeline, type Timeline } from "@/lib/dashboard/timeline";
import {
  LANGUAGE_LABEL,
  type EventCategory,
  type EventLanguage,
  type EventLevel,
} from "@/lib/events-catalog";
import {
  writesAfterFailedLockRead,
  type SubmissionsLock,
} from "@/lib/submissions/lock-state";

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

export interface SchoolOption {
  id: string;
  label: string;
}

export interface DashboardData {
  /** One instant for the whole response, so no two panels disagree about "now". */
  now: Date;
  adminName: string;
  kpis: Kpi[];
  perSchool: PerSchoolSummary;
  schoolOptions: SchoolOption[];
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
  /**
   * The division-wide submissions switch, for the header control. Three states,
   * not a boolean: "unknown" is a real answer here and must not be flattened
   * into "unlocked".
   */
  submissionsLock: SubmissionsLock;
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
/**
 * How many events have a judge's sheet the office has not acted on.
 *
 * The number on the sidebar's Tabulators item. Two small reads and no join: the
 * whole division has at most four sheets per event, and `event_rounds` one row per
 * event, so this is a fraction of what the judges index costs — which matters
 * because the shell renders it on every admin page, not just the judging ones.
 *
 * `cache()` for the same reason every loader here has it: the layout and a page can
 * both ask within one request and pay once.
 *
 * Fails soft, deliberately. This is a convenience on a nav item, and a badge that
 * could break the whole console would be a bad trade for it — a failed read shows no
 * badge, which is what an admin sees when there is nothing waiting anyway. The
 * judges portal remains the place where the state is reported properly.
 */
export const loadPendingJudgeReviews = cache(async (): Promise<number> => {
  try {
    const supabase = await getAdminClient();
    const [{ data: sheets }, { data: rounds }] = await Promise.all([
      supabase
        .from("judge_sheets")
        .select("event_id, round, submitted_at")
        .not("submitted_at", "is", null)
        .overrideTypes<PendingSheet[]>(),
      supabase
        .from("event_rounds")
        .select("event_id, round1_locked_at, results_locked_at")
        .overrideTypes<PendingRound[]>(),
    ]);

    return pendingJudgeReviewCount(sheets ?? [], rounds ?? []);
  } catch {
    return 0;
  }
});


/**
 * The division-wide submissions switch: `app_settings`, one row, `id = true`.
 *
 * **This read fails soft on purpose, and it is not a hole.** Enforcement lives
 * entirely in the trigger functions migration 0022 installs, which raise inside
 * the database on every school-side write and cannot be reached around; nothing
 * in this file is a guard. All this read decides is what the dashboard header
 * shows. So when the table or the row is not there — the state of production
 * until 0022 is applied — the dashboard must render exactly as it did before this
 * feature existed rather than 500 on a `select` against a missing relation. Do
 * not "harden" this into a throw: it would take the whole admin dashboard down
 * without making one single write more, or less, permitted.
 *
 * The failures are kept apart because they mean different things. `no-row` is an
 * emergency: `submissions_locked_globally()` raises when the singleton is gone, so
 * every school-side write is being refused right now — and the RPC's insert branch
 * is the repair, which is why the control stays live in that state. `unreadable`
 * covers everything else, and it carries `writes` because those failures are not
 * one situation: the switch reporting itself absent means nothing is frozen, a
 * raise from Postgres over objects that exist means everything is, and a timeout
 * or an expired session means this page learned nothing and must say so.
 */
export const loadSubmissionsLock = cache(async (): Promise<SubmissionsLock> => {
  const supabase = await getAdminClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("submissions_locked, submissions_locked_at, submissions_locked_by")
    .eq("id", true)
    .maybeSingle()
    .overrideTypes<{
      submissions_locked: boolean | null;
      submissions_locked_at: string | null;
      submissions_locked_by: string | null;
    }>();

  if (error) {
    console.error("loadSubmissionsLock", error);
    // Still soft, deliberately: a missing table must not 500 the dashboard, and
    // it is safe to shrug here because nothing in this file enforces the lock —
    // the 0022 triggers do, in the database, on every school-side write.
    //
    // What the code decides is what the dashboard *claims* meanwhile, and there
    // are three answers rather than two. `writesAfterFailedLockRead()` requires
    // positive evidence for each of the two definite ones: the schema saying the
    // switch is absent, so no trigger consults a flag and writes really are open;
    // or Postgres raising over objects that exist, so the guard is standing over a
    // flag it cannot read and refuses every write. An expired JWT, a statement
    // timeout, a 5xx or a `fetch` that never landed establishes neither, and the
    // panel says so instead of picking one. It used to pick "refused" for all of
    // them — `!isMissingLockGuard(error.code)` — which is why a timeout on
    // production, where 0022 is not applied and submissions are open, printed
    // "Registration Closed".
    return {
      state: "unknown",
      reason: "unreadable",
      detail: error.message,
      writes: writesAfterFailedLockRead(error.code),
    };
  }

  // Not `false`. The select policy is scoped `to authenticated`, so a caller
  // without a session reads zero rows rather than an unlocked flag — and a
  // deleted singleton reads the same way. Either is "we do not know".
  if (!data) {
    return {
      state: "unknown",
      reason: "no-row",
      detail: "app_settings returned no row for id = true.",
      // Not a guess: `submissions_locked_globally()` selects that row and raises
      // when it is not there, so every school-side write is being refused right
      // now.
      writes: "refused",
    };
  }

  // Both branches named explicitly, and anything else routed to unknown. 0022
  // declares the column `not null default false`, so a null is unreachable — but
  // the old `if (!data.submissions_locked)` read one as "unlocked", which means a
  // column altered by hand could have reported an open division on no evidence at
  // all. A value nobody can interpret is not a state; it is a missing reading.
  if (data.submissions_locked !== true && data.submissions_locked !== false) {
    return {
      state: "unknown",
      reason: "unusable-flag",
      detail:
        "app_settings.submissions_locked is neither true nor false, on a column migration 0022 declares not null.",
      writes: "undetermined",
    };
  }

  if (data.submissions_locked === false) return { state: "unlocked" };

  // Who locked it, if that can be answered at all. `admin_profiles` is
  // self-read under RLS ("self read admin_profiles", 0001), so this resolves a
  // name exactly when the admin who locked the division is the admin reading the
  // page, and comes back empty for anyone else. That is the whole reason the
  // copy has an "another administrator" branch: a raw uuid on screen would be
  // worse than no name at all.
  let byName: string | null = null;
  if (data.submissions_locked_by) {
    const { data: owner } = await supabase
      .from("admin_profiles")
      .select("full_name")
      .eq("user_id", data.submissions_locked_by)
      .maybeSingle()
      .overrideTypes<{ full_name: string | null }>();
    byName = owner?.full_name?.trim() || null;
  }

  return {
    state: "locked",
    at: data.submissions_locked_at,
    by: data.submissions_locked_by,
    byName,
  };
});
/**
 * The dashboard's slice of the schools query. The query itself lives in
 * `lib/dashboard/school-facts.ts` because `/admin/overall-data` and its export route
 * need the same numbers, and a route handler cannot come through this file:
 * `requireAdmin()` redirects, and a redirect answered to a click that expected a
 * spreadsheet returns a login page with a 200.
 *
 * cache() still belongs here, not there — it keys on arguments, and the shared function
 * takes a client, so memoising it there would key on a different object per caller.
 */
export const loadSchoolFacts = cache(async (): Promise<SchoolFacts> => {
  return fetchSchoolFacts(await getAdminClient());
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
 * The four counts behind the attention list.
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

/**
 * The dashboard's slice of the feed. The queries live in
 * `lib/dashboard/activity-source.ts` because /admin/activity needs the same six with a
 * larger limit, and 130 duplicated lines would drift on the first schema change.
 *
 * Fetches ACTIVITY_FETCH_LIMIT per source so the newest ACTIVITY_SHOWN overall are
 * certain to be among them, then cuts to ACTIVITY_SHOWN. Slicing a correctly-ordered
 * list to a shorter prefix is always safe, which is what makes fetch-8-show-5
 * legitimate while fetch-8-merge-50 would not be.
 *
 * `truncated` is re-derived rather than passed through: the merge answered the question
 * for a feed of ACTIVITY_FETCH_LIMIT, and this one is shorter still, so anything the
 * slice drops counts too.
 */
export const loadActivity = cache(async (): Promise<ActivityFeed> => {
  const feed = await fetchActivity(await getAdminClient(), ACTIVITY_FETCH_LIMIT);

  return {
    items: feed.items.slice(0, ACTIVITY_SHOWN),
    truncated: feed.truncated || feed.items.length > ACTIVITY_SHOWN,
  };
});

/** Everything the overview page renders, in one call. */
export const loadDashboardData = cache(async (): Promise<DashboardData> => {
  const [
    schools,
    roster,
    entryFacts,
    events,
    activity,
    attentionInput,
    adminName,
    submissionsLock,
  ] = await Promise.all([
    loadSchoolFacts(),
    loadRosterFacts(),
    loadEntryFacts(),
    loadEventFacts(),
    loadActivity(),
    loadAttentionInput(),
    loadAdminName(),
    loadSubmissionsLock(),
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
    // Every school with data, untruncated — the portal card's select is a dropdown, not
    // a panel, so PER_SCHOOL_LIMIT does not apply to it. Already name-ordered:
    // fetchSchoolFacts orders its query by name.
    schoolOptions: schools.active.map((school) => ({
      id: school.schoolId,
      label: school.schoolName,
    })),
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
      // The whole state, not a boolean. buildTimeline() needs both of the
      // questions it answers — whether school-side writes are being refused,
      // which closes registration, and whether an administrator actually locked
      // anything, which is all the detail line may claim — and it needs the third
      // answer to the first: a read that established nothing renders as "state
      // unknown" rather than as either "Closed" or "Open".
      submissionsLock,
    }),
    submissionsLock,
    eventGroups: events.groups,
  };
});
