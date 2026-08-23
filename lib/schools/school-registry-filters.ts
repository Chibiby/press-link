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

/**
 * The query's shape turned into the row shape the registry table and the
 * dashboard both read.
 *
 * Out of the component so it can be tested: every test here runs under
 * `environment: "node"`, so a `.map` left inside an async server component is
 * permanently unreachable — and this one is not pure renaming. A count that comes
 * back as `[]` has to become `0` and not `undefined`, or the footer's totals go
 * to `NaN` and the "Nothing on record" badge stops appearing.
 */
export function toRegistryRows(raw: RawRegistrySchool[]): RegistryRow[] {
  return raw.map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    schoolIdNumber: row.school_id_number,
    districtId: row.district_id,
    districtName: row.districts?.name ?? "",
    isIntegrated: row.is_integrated,
    learners: row.participants?.[0]?.count ?? 0,
    coaches: row.coaches?.[0]?.count ?? 0,
    entries: row.entries?.[0]?.count ?? 0,
    lockedAt: row.submission_locked_at,
  }));
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
 * The status the page is on, falling back to "all".
 *
 * A junk `?status=` shows the whole roll rather than an empty table — the rule
 * every closed-union filter in `lib/` follows, and the one the page already
 * applied inline. Search is the exception and is handled separately: a typed
 * query cannot be unrecognised, so its empty result is the true answer.
 *
 * Exported because the page also needs it for the subtitle, which names the status
 * in words. Two copies of this fallback would be two answers to "is this table
 * filtered" the first time one of them changed.
 */
export function schoolRegistryStatus(filters: SchoolRegistryFilters): SchoolStatus {
  return isSchoolStatus(filters.status) ? filters.status : "all";
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
  const matched = rows.filter((row) =>
    matchesQuery([row.schoolName, row.schoolIdNumber], query)
  );

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
  const otherFilters = Boolean(filters.district) || schoolRegistryStatus(filters) !== "all";

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
