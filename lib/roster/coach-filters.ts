import { matchesQuery } from "@/lib/search/matches-query";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import {
  filterCoachRows,
  type AdminCoachRow,
  type CoachFilters,
} from "./admin-coach-rows";

/**
 * Which rows /admin/coaches shows, and what to say when that is none of them.
 *
 * The same split `lib/roster/participant-filters.ts` makes for the roster next
 * door: the dropdowns already have a tested predicate — `filterCoachRows` in
 * `./admin-coach-rows.ts` — so this module adds the search box on top of it and
 * owns the sentence the table prints when nothing survives. `admin-coach-rows.ts`
 * is about shaping a Supabase row; this is about reading a URL, which is why the
 * two are separate files rather than one growing a second job.
 */

/**
 * The params this page reads: every dropdown and toggle `CoachFilters` already
 * had, plus the search box.
 *
 * The search key is computed from {@link SEARCH_PARAM} rather than written as
 * `q`, so this type cannot name a param the filter bar does not write. It is the
 * one key typed `string | string[]`, because that is what Next hands a page for
 * `?q=a&q=b` and it is the one value here that gets a string method called on it.
 */
export interface CoachListFilters extends CoachFilters {
  [SEARCH_PARAM]?: string | string[];
}

/**
 * The search text as one string.
 *
 * `?q=cruz&q=reyes` resolves to `["cruz", "reyes"]`, and the first value wins
 * because that is what `useSearchParams().get(SEARCH_PARAM)` returns in the
 * filter bar above — the box and the table have to agree about which one they are
 * showing. Handing the array straight to `matchesQuery` would instead throw on
 * `.trim()` and take the whole page down over a malformed URL.
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
export function coachSearchQuery(filters: CoachListFilters): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

/**
 * Which of the dropdowns and toggles are actually selecting something.
 *
 * Read only by the empty state, and it mirrors `filterCoachRows` value for value:
 * an unrecognised URL value is no filter there, so it must not count as a filter
 * here either, or `?gender=X` would claim to be narrowing while it is not and the
 * table would offer a way back from a filter that is off. The two are kept in step
 * by a test that runs every junk value through both.
 *
 * The ids — district, school, event — cannot be validated against anything this
 * module holds, so any non-empty value counts, exactly as `filterCoachRows`
 * treats them.
 */
function activeRowFilters(filters: CoachListFilters) {
  const { gender, category, level, language } = filters;

  return {
    district: filters.district || null,
    school: filters.school || null,
    gender: gender === "M" || gender === "F" ? gender : null,
    multiOnly: filters.multi === "1",
    unassignedOnly: filters.unassigned === "1",
    event: filters.event || null,
    category: category === "individual" || category === "group" ? category : null,
    level: level === "elementary" || level === "secondary" ? level : null,
    language: language === "english" || language === "filipino" ? language : null,
  };
}

/**
 * The page's rows: the dropdown predicate, then the search box.
 *
 * Named `filterCoachListRows` and not `filterCoachRows` because that name belongs
 * to the function this one calls. Filtering happens in memory rather than in the
 * query because the page's read already pulls every coach — it has to, or the
 * "N of M" badge lies — so narrowing in the database would buy nothing and would
 * introduce a second matching semantics beside `matchesQuery`, where a typed `%`
 * became a wildcard on one page and a literal on the next.
 */
export function filterCoachListRows(
  rows: AdminCoachRow[],
  filters: CoachListFilters
): AdminCoachRow[] {
  const query = coachSearchQuery(filters) ?? "";

  // The two things a reader has in front of them when they go looking: the name
  // and the school. `displayName` and not `fullName`, so the asterisk a
  // multi-entry coach is printed with survives a copy-paste of the cell —
  // "*Reyes, Mario" and "Reyes, Mario" both find the same coach, since `fullName`
  // is a substring of `displayName` either way.
  //
  // District and gender are deliberately not searchable: both have their own
  // dropdown right above the table, and typing "District I" would sweep in a
  // third of the roster, which is the opposite of narrowing. Nor are the event,
  // category, level and language dimensions, for the same reason — and because
  // none of them is printed in a cell, so nobody would be copying one off screen.
  return filterCoachRows(rows, filters).filter((row) =>
    matchesQuery([row.displayName, row.schoolName], query)
  );
}

export interface CoachEmptyState {
  /** What the table says in place of rows. Names the cause, never just "none". */
  message: string;
  /**
   * Whether a control is narrowing the list, and so whether the page owes the
   * reader a way back to the full roster.
   *
   * Driven off the controls, not off `shown < total`: an empty roster and a query
   * that matches nothing are two different facts, and only one of them has a way
   * out. A query that happens to match every coach still gets one.
   */
  narrowed: boolean;
}

/**
 * What to render when the table has no rows.
 *
 * Four distinct facts, because "no rows" has four causes and a reader can only
 * act on the one that applies to them. A search that matches nothing is quoted
 * back: seeing the query is how someone spots the typo, and it is the difference
 * between "your search found nobody" and "there are no coaches", which is a claim
 * this page must never make while several hundred of them are on file.
 */
export function coachEmptyState(filters: CoachListFilters): CoachEmptyState {
  const query = coachSearchQuery(filters);
  const otherFilters = Object.values(activeRowFilters(filters)).some(Boolean);

  if (query && otherFilters) {
    return {
      // Both are named, because either one alone might have matched and the
      // reader gets to choose which to drop.
      message: `No coaches match “${query}” with these filters.`,
      narrowed: true,
    };
  }
  if (query) {
    return { message: `No coaches match “${query}”.`, narrowed: true };
  }
  if (otherFilters) {
    // The wording the page has always used for this case, unchanged.
    return { message: "No coaches match these filters.", narrowed: true };
  }
  // Nothing is set, so the roster itself is empty — before the first school
  // registers, or if the read came back with nothing.
  return { message: "No coaches are registered yet.", narrowed: false };
}
