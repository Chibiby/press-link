import type { EventCategory } from "@/lib/events-catalog";
import { matchesQuery } from "@/lib/search/matches-query";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import {
  isSchoolStatus,
  summariseRegistry,
  type RegistryRow,
  type RegistrySummary,
  type SchoolStatus,
} from "@/lib/dashboard/school-registry";

/**
 * Which rows /admin/schools shows, and what to say when that is none of them.
 *
 * `lib/dashboard/school-registry.ts` already owns the two questions the dashboard
 * and this page ask together — what each status selects, and how the "N of M"
 * denominator works — and it is shared, so it stays as it is. This module is the
 * page's own half: the Supabase row mapper the component used to inline, the
 * search box on top of that shared predicate, and the sentence the table prints
 * when nothing survives. It lives in `lib/schools/` beside `integrated.ts`, the
 * other module about what a school *is*, rather than in `lib/dashboard/`, which
 * is shared with pages that have no search box.
 */

/** A `schools` row joined to its district and counts, as /admin/schools fetches it. */
export interface RawRegistrySchool {
  id: string;
  name: string;
  school_id_number: string;
  district_id: string;
  is_integrated: boolean;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  /**
   * `participants(count)`, `coaches(count)` and `entries(count)` each arrive as a
   * one-element array — or as an empty one when the school has none — which is
   * why the mapper below unwraps rather than reads a number.
   */
  participants: { count: number }[];
  coaches: { count: number }[];
  entries: { count: number }[];
}

/** One `entries` row read to compute per-category learner/coach counts, as
 *  /admin/schools and its export route both fetch it. */
export interface RawRegistryEntry {
  school_id: string;
  events: { category: EventCategory } | null;
  entry_participants: { participants: { id: string } | null }[];
  entry_coaches: { coaches: { id: string } | null }[];
}

export interface CategoryCounts {
  individualLearners: number;
  individualCoaches: number;
  groupLearners: number;
  groupCoaches: number;
}

/**
 * Distinct participants/coaches per school per category, from one paged read of
 * `entries`. The same dedup-by-id principle `distinctCoaches` (lib/roster/entry-
 * coaches.ts) applies to one entry's link rows, folded here across every entry a
 * school has, scoped separately per category: a coach or learner counted once
 * per category regardless of how many entries or contestants they appear on.
 * Entries whose event join came back null (dangling FK) contribute to neither
 * category rather than crashing the aggregation.
 */
export function categoryCountsBySchool(
  entries: RawRegistryEntry[]
): Map<string, CategoryCounts> {
  interface Accumulator {
    individualLearners: Set<string>;
    individualCoaches: Set<string>;
    groupLearners: Set<string>;
    groupCoaches: Set<string>;
  }

  const bySchool = new Map<string, Accumulator>();

  for (const entry of entries) {
    const category = entry.events?.category;
    if (!category) continue;

    let acc = bySchool.get(entry.school_id);
    if (!acc) {
      acc = {
        individualLearners: new Set(),
        individualCoaches: new Set(),
        groupLearners: new Set(),
        groupCoaches: new Set(),
      };
      bySchool.set(entry.school_id, acc);
    }

    const learners = category === "individual" ? acc.individualLearners : acc.groupLearners;
    const coaches = category === "individual" ? acc.individualCoaches : acc.groupCoaches;

    for (const link of entry.entry_participants) {
      if (link.participants) learners.add(link.participants.id);
    }
    for (const link of entry.entry_coaches) {
      if (link.coaches) coaches.add(link.coaches.id);
    }
  }

  return new Map(
    [...bySchool.entries()].map(([schoolId, acc]) => [
      schoolId,
      {
        individualLearners: acc.individualLearners.size,
        individualCoaches: acc.individualCoaches.size,
        groupLearners: acc.groupLearners.size,
        groupCoaches: acc.groupCoaches.size,
      },
    ])
  );
}

/**
 * The query's shape turned into the row shape the registry table and the
 * dashboard both read.
 *
 * Out of the component so it can be tested: every test here runs under
 * `environment: "node"`, so a `.map` left inside an async server component is
 * permanently unreachable — and this one is not pure renaming. A count that comes
 * back as `[]` has to become `0` and not `undefined`, or the footer's totals go
 * to `NaN` and the "Nothing on record" badge stops appearing.
 *
 * `categoryCounts` is a second, separate read — `categoryCountsBySchool` over the
 * division's `entries` — rather than something this mapper derives from `raw`
 * itself: a school row carries no per-category figures at all, only the
 * whole-roster `learners`/`coaches`/`entries` counts. A school absent from the
 * map (no entry in either category) gets all-zero counts, not `undefined`.
 */
export function toRegistryRows(
  raw: RawRegistrySchool[],
  categoryCounts: Map<string, CategoryCounts>
): RegistryRow[] {
  return raw.map((row) => {
    const counts = categoryCounts.get(row.id) ?? {
      individualLearners: 0,
      individualCoaches: 0,
      groupLearners: 0,
      groupCoaches: 0,
    };

    return {
      schoolId: row.id,
      schoolName: row.name,
      schoolIdNumber: row.school_id_number,
      districtId: row.district_id,
      districtName: row.districts?.name ?? "",
      isIntegrated: row.is_integrated,
      learners: row.participants?.[0]?.count ?? 0,
      coaches: row.coaches?.[0]?.count ?? 0,
      entries: row.entries?.[0]?.count ?? 0,
      individualLearners: counts.individualLearners,
      individualCoaches: counts.individualCoaches,
      groupLearners: counts.groupLearners,
      groupCoaches: counts.groupCoaches,
      lockedAt: row.submission_locked_at,
    };
  });
}

/**
 * The params this page reads.
 *
 * The search key is computed from {@link SEARCH_PARAM} rather than written as
 * `q`, so this type cannot name a param the filter bar does not write. It is the
 * one key typed `string | string[]`, because that is what Next hands a page for
 * `?q=a&q=b` and it is the one value here that gets a string method called on it.
 */
export interface SchoolRegistryFilters {
  [SEARCH_PARAM]?: string | string[];
  district?: string;
  status?: string;
  /**
   * What the two individual columns count: everybody entered, or only those through
   * to round 2. Read by {@link individualCountMode}.
   *
   * Under `qualifiers` it also narrows the table to the schools that have somebody
   * in round 2. It did not at first — it kept every school and printed two noughts,
   * on the reasoning that a measured nought is an answer — but the answer a reader
   * wants from "Round 2 qualifiers" is the list of schools with a qualifier on it,
   * and three hundred rows of noughts buries that list rather than reporting it.
   */
  individual?: string;
}

/**
 * The search text as one string.
 *
 * `?q=alabel&q=maasim` resolves to an array, and the first value wins because
 * that is what `useSearchParams().get(SEARCH_PARAM)` returns in the filter bar
 * above — the box and the table have to agree about which one they are showing.
 * Handing the array straight to `matchesQuery` would instead throw on `.trim()`
 * and take the whole page down over a malformed URL.
 */
function firstValue(raw: string | string[] | undefined): string {
  if (raw === undefined) return "";
  if (Array.isArray(raw)) return raw.length > 0 ? raw[0] : "";
  return raw;
}

/**
 * The typed query, trimmed, or null when the box is empty — the same "trimmed,
 * and absent rather than empty" rule the bar applies before it writes to the URL,
 * so `?q=%20%20` narrows nothing here just as it counts as nothing there.
 */
export function schoolRegistrySearchQuery(
  filters: SchoolRegistryFilters
): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

/**
 * The status the page is on, falling back to "entered".
 *
 * An absent or junk `?status=` shows schools with at least one entry, not the
 * whole roll — a division-wide roster is over 300 rows deep, most of them
 * nothing yet on record, and that is not the table an officer opening the page
 * cold is looking for. `?status=all` still resolves to `"all"` explicitly:
 * `isSchoolStatus("all")` is true, so a reader who wants the whole roll asks for
 * it by name rather than getting it as the unset default.
 *
 * Exported because the page also needs it for the subtitle, which names the status
 * in words. Two copies of this fallback would be two answers to "is this table
 * filtered" the first time one of them changed.
 */
export function schoolRegistryStatus(filters: SchoolRegistryFilters): SchoolStatus {
  return isSchoolStatus(filters.status) ? filters.status : "entered";
}

/**
 * The rows the table shows, the two numbers the subtitle prints, and the column
 * sums in the footer.
 *
 * `summariseRegistry` is called twice on purpose, rather than its result being
 * re-filtered here. The denominator is the honest one it already defines —
 * schools in the district, whatever the status — and the numerator, the rows and
 * their totals all have to come out of one pass so the footer cannot sum a
 * different set from the one on screen. Re-summing the columns in this module
 * would be a second copy of that arithmetic, free to drift.
 *
 * Search narrows the *view*, like status and unlike district: typing three letters
 * must not change what "of 18 schools in Alabel" means, or the subtitle would
 * always read "3 of 3" and stop being a comparison at all.
 *
 * Filtering happens in memory rather than in the query because the page's read
 * already pulls every school — it has to, or the footer's totals are wrong — so
 * narrowing in the database would buy nothing and would introduce a second
 * matching semantics beside `matchesQuery`, where a typed `%` became a wildcard on
 * one page and a literal on the next.
 */
export function summariseSchoolRegistry(
  rows: RegistryRow[],
  filters: SchoolRegistryFilters
): RegistrySummary {
  const query = schoolRegistrySearchQuery(filters) ?? "";
  const districtId = filters.district ?? null;

  // The school's name and the id number printed under it. Both are on screen in
  // the first cell, so an officer reading a number off the row — or off a form on
  // their desk — finds it here, and `schools.school_id_number` is text and unique,
  // which is the whole reason the column is printed at all.
  //
  // District is deliberately not searchable: it has its own dropdown right above
  // the table, and typing "Alabel" would sweep in a whole district, which is the
  // opposite of narrowing and could disagree with a control still showing "All
  // districts". Nor is the "Integrated" badge, which is one of the status
  // dropdown's own options, nor the Learners/Coaches/Entries counts — a search box
  // that matched "12" against three unrelated columns would be noise.
  const searched = rows.filter((row) =>
    matchesQuery([row.schoolName, row.schoolIdNumber], query)
  );

  // The round-2 view hides a school that got nobody through. It was built to keep
  // every school and show two noughts, on the reasoning that a measured nought is
  // an answer — but the answer a reader wants from "Round 2 qualifiers" is the list
  // of schools that have somebody in round 2, and three hundred rows of noughts
  // buries it. So it narrows the table like the controls beside it.
  //
  // Individual only, and that is the whole of it: a school here has at least one
  // learner on a qualifier list. Its group columns still print whatever it has,
  // because a group contest has no second round to be counted against
  // (non-negotiable 6) — but a school with only group entries does not appear at
  // all, because nothing of it reached round 2.
  const matched =
    individualCountMode(filters) === "qualifiers"
      ? searched.filter((row) => row.individualLearners > 0)
      : searched;

  const status = schoolRegistryStatus(filters);
  const view = summariseRegistry(matched, { status, districtId });
  // District alone, so the denominator is the population the district selects and
  // not what the status and the search box have left of it.
  const population = summariseRegistry(rows, { status: "all", districtId });

  return { ...view, registered: population.registered };
}

export interface SchoolRegistryEmptyState {
  /** What the table says in place of rows. Names the cause, never just "none". */
  message: string;
  /**
   * Whether a control is narrowing the list, and so whether the page owes the
   * reader a way back to the whole roll.
   *
   * Driven off the controls, not off `shown < registered`: an empty roll and a
   * query that matches nothing are two different facts, and only one of them has
   * a way out. A query that happens to match every school still gets one.
   */
  narrowed: boolean;
}

/**
 * What to render when the table has no rows.
 *
 * Four distinct facts, because "no rows" has four causes and a reader can only act
 * on the one that applies to them. A search that matches nothing is quoted back:
 * seeing the query is how someone spots the typo, and it is the difference between
 * "your search found no school" and "there are no schools", which is a claim this
 * page must never make while 332 of them are on the roll.
 */
export function schoolRegistryEmptyState(
  filters: SchoolRegistryFilters
): SchoolRegistryEmptyState {
  const query = schoolRegistrySearchQuery(filters);
  // "all" is the placeholder rather than a selection, so it is not narrowing —
  // and neither is a junk value, which `selectedStatus` has already turned into
  // "all". Otherwise `?status=nonsense` would offer a way back from a filter that
  // is off.
  const otherFilters =
    Boolean(filters.district) ||
    schoolRegistryStatus(filters) !== "all" ||
    individualCountMode(filters) === "qualifiers";

  // Named before the generic sentences below, because it is the one narrowing whose
  // empty table is most likely to be the truth rather than a mistake: nobody has
  // been through round 1 yet. "No schools match these filters" would send an
  // officer looking for a control to undo.
  if (individualCountMode(filters) === "qualifiers" && !query && !filters.district) {
    return {
      message:
        "No school has anybody through to round 2 yet. A qualifier list is drawn when an administrator closes an event's round 1.",
      narrowed: true,
    };
  }

  if (query && otherFilters) {
    return {
      // Both are named, because either one alone might have matched and the
      // reader gets to choose which to drop.
      message: `No schools match “${query}” with these filters.`,
      narrowed: true,
    };
  }
  if (query) {
    return { message: `No schools match “${query}”.`, narrowed: true };
  }
  if (otherFilters) {
    // Plural, where the page used to say "No school matches this filter." — there
    // are three controls above the table now, and the singular named a count that
    // is no longer true.
    return { message: "No schools match these filters.", narrowed: true };
  }
  // Nothing is set, so the roll itself is empty — or the read came back with
  // nothing.
  return { message: "No schools are on the division roll yet.", narrowed: false };
}

/**
 * Reads {@link SchoolRegistryFilters} off a `URLSearchParams`-shaped object.
 *
 * The export route's params come as `request.nextUrl.searchParams`, not the
 * plain object Next hands the page, and this is what keeps the two reading the
 * same keys: the route cannot misspell one, because it never names one. Typed
 * against the single method it needs, so both `URLSearchParams` and the
 * read-only object `useSearchParams()` returns satisfy it.
 */
export function schoolRegistryFiltersFromParams(params: {
  get(key: string): string | null;
}): SchoolRegistryFilters {
  const value = (key: string) => params.get(key) ?? undefined;

  return {
    [SEARCH_PARAM]: value(SEARCH_PARAM),
    district: value("district"),
    status: value("status"),
    // Carried so a workbook taken while the table is showing round-2 figures holds
    // round-2 figures. A file that answered a different question from the screen it
    // came from is the failure this whole function exists against.
    individual: value("individual"),
  };
}

/**
 * Whether search, district or a non-"all" status is narrowing the view.
 *
 * Search-inclusive, unlike {@link schoolRegistryEmptyState}'s internal
 * `otherFilters` check: that one deliberately excludes search so it can name
 * the two causes of an empty table separately in its message. This is used only
 * by the export filename, which has one word — "filtered" — for any control
 * that narrowed the sheet, search included.
 */
export function schoolRegistryFiltersActive(filters: SchoolRegistryFilters): boolean {
  if (schoolRegistrySearchQuery(filters) !== null) return true;
  if (filters.district) return true;
  // It hides schools now, so a workbook taken under it is a filtered workbook and
  // its filename has to say so.
  if (individualCountMode(filters) === "qualifiers") return true;
  return schoolRegistryStatus(filters) !== "all";
}

/**
 * The exported workbook's filename: "press-link-schools-filtered-2026-08-24.xlsx"
 * whenever {@link schoolRegistryFiltersActive} is true, and the unmarked base name
 * otherwise — mirroring `entriesExportFilename` (lib/entries/admin-entry-filters.ts)
 * and `overallDataExportFilename` (lib/admin/overall-data-filters.ts).
 *
 * The scope is in the name and not the filters themselves, the same call those two
 * make: a search box, a district and a status do not fit in a filename, and a
 * half-told scope is worse than a flagged one. The file outlives the tab it came
 * from, so a narrowed sheet must not be filed later as the whole division roll.
 */
export function schoolRegistryExportFilename(
  filters: SchoolRegistryFilters,
  date: string
): string {
  const scope = schoolRegistryFiltersActive(filters) ? "filtered-" : "";
  return `press-link-schools-${scope}${date}.xlsx`;
}

/**
 * One `round2_qualifiers` row, joined to the school that entered it.
 *
 * Individual by construction: the two-stage rounds cover individual events only
 * (non-negotiable 6), so a qualifier row can only ever belong to an individual
 * entry. That is why this narrows the *individual* columns and leaves the group
 * ones alone — there is no such thing as a group qualifier to count.
 */
export interface RawRegistryQualifier {
  participant_id: string;
  entry_id: string;
  entries: { school_id: string } | null;
}

/** One `entry_coaches` row on an entry that has qualifiers on it. */
export interface RawRegistryQualifierCoach {
  entry_id: string;
  coach_id: string;
  /** The contestant this coach is for; null on a pre-0019 entry. */
  participant_id: string | null;
}

export interface QualifierCounts {
  individualLearners: number;
  individualCoaches: number;
}

/**
 * Who from each school reached round 2, and who coaches them.
 *
 * A learner is counted once however many events they qualified in — the columns
 * count people, the way `categoryCountsBySchool` does, so a contestant through in
 * two contests is one learner going to round 2 and not two.
 *
 * A coach counts when they are paired with a contestant who qualified. The pairing
 * is 0019's `entry_coaches.participant_id`, which on an individual entry names
 * exactly one contestant per coach — so a school whose three contestants share one
 * adviser and whose one qualifier is coached by them reports one coach, not three.
 *
 * A row with no pairing at all is the exception, and it is counted for any qualifier
 * on its entry. Those are pre-0019 rows that never recorded who the coach was for;
 * dropping them would report a qualifying contestant as having no coach at all,
 * which is a worse answer than naming the coach their entry does carry.
 */
export function qualifierCountsBySchool(
  qualifiers: RawRegistryQualifier[],
  coachLinks: RawRegistryQualifierCoach[]
): Map<string, QualifierCounts> {
  interface Accumulator {
    learners: Set<string>;
    coaches: Set<string>;
  }

  const bySchool = new Map<string, Accumulator>();
  /** Which entries have a qualifier on them, and which of their contestants. */
  const qualifyingByEntry = new Map<string, Set<string>>();
  const schoolByEntry = new Map<string, string>();

  for (const row of qualifiers) {
    const schoolId = row.entries?.school_id;
    // A qualifier whose entry join came back null has no school to be counted
    // against — the same treatment a dangling event join gets in
    // `categoryCountsBySchool`, and for the same reason: it must not crash the
    // aggregation and must not be attributed to an arbitrary school.
    if (!schoolId) continue;

    let acc = bySchool.get(schoolId);
    if (!acc) {
      acc = { learners: new Set(), coaches: new Set() };
      bySchool.set(schoolId, acc);
    }
    acc.learners.add(row.participant_id);

    schoolByEntry.set(row.entry_id, schoolId);
    const onEntry = qualifyingByEntry.get(row.entry_id) ?? new Set<string>();
    onEntry.add(row.participant_id);
    qualifyingByEntry.set(row.entry_id, onEntry);
  }

  for (const link of coachLinks) {
    const schoolId = schoolByEntry.get(link.entry_id);
    if (!schoolId) continue;
    const qualifying = qualifyingByEntry.get(link.entry_id);
    if (!qualifying) continue;

    // Paired with somebody who did not qualify: that coach is not going to round 2
    // on this entry, and counting them would report the whole entry's advisers as
    // qualifying because one of their contestants did.
    if (link.participant_id !== null && !qualifying.has(link.participant_id)) continue;

    bySchool.get(schoolId)?.coaches.add(link.coach_id);
  }

  return new Map(
    [...bySchool.entries()].map(([schoolId, acc]) => [
      schoolId,
      { individualLearners: acc.learners.size, individualCoaches: acc.coaches.size },
    ])
  );
}

/**
 * The rows with their individual columns replaced by the round-2 figures.
 *
 * The group columns are untouched, which is not an omission: a group contest has no
 * second round to qualify for (non-negotiable 6), so "group qualifiers" is not a
 * quantity that exists.
 *
 * A school absent from the map had nobody go through and gets two noughts here. It
 * does not stay on the table with them: `summariseSchoolRegistry` drops a row whose
 * qualifier count is nought under this mode. The nought is set rather than left
 * undefined because this function's job is to state the figure, and the decision to
 * hide the row belongs to the one place every other narrowing is decided.
 */
export function applyQualifierCounts(
  rows: RegistryRow[],
  qualifierCounts: Map<string, QualifierCounts>
): RegistryRow[] {
  return rows.map((row) => {
    const counts = qualifierCounts.get(row.schoolId);
    return {
      ...row,
      individualLearners: counts?.individualLearners ?? 0,
      individualCoaches: counts?.individualCoaches ?? 0,
    };
  });
}

/** What the individual columns are counting. */
export type IndividualCountMode = "all" | "qualifiers";

/** The dropdown's two options, and the tooltip the columns carry under each. */
export const INDIVIDUAL_COUNT_LABEL: Record<IndividualCountMode, string> = {
  all: "Everyone entered",
  qualifiers: "Round 2 qualifiers",
};

export const INDIVIDUAL_COLUMN_NOTE: Record<IndividualCountMode, string> = {
  all: "Every learner and coach this school has on an individual entry.",
  qualifiers:
    "Only those through to round 2: the learners on this school's qualifier list, and the coaches paired with them. Group contests have no second round, so those two columns are unchanged.",
};

/**
 * Which of the two the URL is asking for.
 *
 * Anything unrecognised is "all", the same fail-safe `schoolRegistryStatus` uses: a
 * mistyped param must not quietly narrow a roll to the schools that got somebody
 * through round 1.
 */
export function individualCountMode(filters: SchoolRegistryFilters): IndividualCountMode {
  return filters.individual === "qualifiers" ? "qualifiers" : "all";
}
