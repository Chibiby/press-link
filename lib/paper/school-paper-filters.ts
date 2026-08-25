import { matchesQuery } from "@/lib/search/matches-query";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import {
  filterSchoolPaperRows,
  type AdminSchoolPaperRow,
  type SchoolPaperFilters,
} from "./admin-papers";

/**
 * Which rows /admin/school-papers shows, and what to say when that is none of
 * them.
 *
 * Beside `./admin-papers.ts` rather than inside it, the way
 * `lib/roster/coach-filters.ts` sits beside `lib/roster/admin-coach-rows.ts`: the
 * dropdowns already have a tested predicate there, so this module adds the search
 * box on top of it and owns the sentence the table prints when nothing survives.
 * Lives in `lib/paper/` because that is where this page's other half already is;
 * a `lib/papers/` beside it would only make the pair harder to find.
 */

/**
 * The params this page reads: the four dropdowns `SchoolPaperFilters` already
 * had, plus the search box.
 *
 * The search key is computed from {@link SEARCH_PARAM} rather than written as
 * `q`, so this type cannot name a param the filter bar does not write. It is the
 * one key typed `string | string[]`, because that is what Next hands a page for
 * `?q=a&q=b` and it is the one value here that gets a string method called on it.
 */
export interface SchoolPaperListFilters extends SchoolPaperFilters {
  [SEARCH_PARAM]?: string | string[];
}

/**
 * The search text as one string.
 *
 * `?q=bagumbayan&q=zamora` resolves to an array, and the first value wins because
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
export function schoolPaperSearchQuery(
  filters: SchoolPaperListFilters
): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

/**
 * Which of the dropdowns are actually selecting something.
 *
 * Read only by the empty state, and it mirrors `filterSchoolPaperRows` value for
 * value: an unrecognised URL value is no filter there, so it must not count as a
 * filter here either, or `?lock=maybe` would claim to be narrowing while it is not
 * and the table would offer a way back from a filter that is off. A test runs every
 * junk value through both to keep them in step.
 */
function activeRowFilters(filters: SchoolPaperListFilters) {
  const { status, lock, language } = filters;

  return {
    district: filters.district || null,
    school: filters.school || null,
    status:
      status === "submitted" || status === "saved" || status === "incomplete"
        ? status
        : null,
    lock: lock === "locked" || lock === "unlocked" ? lock : null,
    language: language === "english" || language === "filipino" ? language : null,
  };
}

/**
 * Schools with at least one paper on file — the unconditional base the page
 * applies before either the dropdowns or the search box run, because a
 * school that has never touched the form has no adviser, gender, principal
 * or grade cell to show and does not belong on a school-paper roster at all,
 * blank or otherwise.
 *
 * "On file" is exactly what `row.languages.length > 0` already means: read
 * off `paperSlots`, not a second look at `school_papers`, so a stale row
 * that contradicts its school (see `levelBelongsTo`) still counts as nothing
 * here either — the same fact `filterSchoolPaperRows`'s `language` filter
 * already relies on.
 */
export function eligibleSchoolPaperRows(
  rows: AdminSchoolPaperRow[]
): AdminSchoolPaperRow[] {
  return rows.filter((row) => row.languages.length > 0);
}

/**
 * The page's rows: the dropdown predicate, then the search box.
 *
 * Filtering happens in memory rather than in the query because the page's read
 * already pulls every school — it has to, or the "N of M" badge lies — so
 * narrowing in the database would buy nothing and would introduce a second
 * matching semantics beside `matchesQuery`, where a typed `%` became a wildcard on
 * one page and a literal on the next.
 */
export function filterSchoolPaperListRows(
  rows: AdminSchoolPaperRow[],
  filters: SchoolPaperListFilters
): AdminSchoolPaperRow[] {
  const query = schoolPaperSearchQuery(filters) ?? "";

  // The school name, and only the school name. Every other column on this table
  // is either a control's own value or not a thing anyone types:
  //
  // - District, Status and "Language on file" each have a dropdown right above
  //   the table, and typing "District I" or "Filipino" would sweep in a third of
  //   the roll — the opposite of narrowing, and it could disagree with the control
  //   showing "All districts" at the same time.
  // - "Answered" prints a date the page formats with `Intl.DateTimeFormat`; the
  //   row holds the ISO timestamp, so matching what is on screen would mean
  //   moving that formatter in here, and "Aug" would then match a third of the
  //   season at once.
  // - There is no paper title or reference number on this table to search — the
  //   row is a school and its name is its identifier.
  return filterSchoolPaperRows(rows, filters).filter((row) =>
    matchesQuery([row.schoolName], query)
  );
}

export interface SchoolPaperEmptyState {
  /** What the table says in place of rows. Names the cause, never just "none". */
  message: string;
  /**
   * Whether a control is narrowing the list, and so whether the page owes the
   * reader a way back to the whole roll.
   *
   * Driven off the controls, not off `shown < total`: an empty roll and a query
   * that matches nothing are two different facts, and only one of them has a way
   * out. A query that happens to match every school still gets one.
   */
  narrowed: boolean;
}

/**
 * What to render when the table has no rows.
 *
 * Four distinct facts, because "no rows" has four causes and a reader can only act
 * on the one that applies to them. A search that matches nothing is quoted back:
 * seeing the query is how someone spots the typo, and it is the difference between
 * "your search found no school" and "there are no schools with a paper filed",
 * which is a claim this page must never make while a search or a dropdown, not
 * the base rule, is what emptied the table.
 */
export function schoolPaperEmptyState(
  filters: SchoolPaperListFilters
): SchoolPaperEmptyState {
  const query = schoolPaperSearchQuery(filters);
  const otherFilters = Object.values(activeRowFilters(filters)).some(Boolean);

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
    // The wording the page has always used for this case, unchanged.
    return { message: "No schools match these filters.", narrowed: true };
  }
  // Nothing is set, so either nothing survived `eligibleSchoolPaperRows` — no
  // school has filed a paper yet, whatever the ~332 on the division roll say —
  // or the read came back with nothing. The old wording named the roll, which
  // this base rule made misleading: the roll is never empty, only paperless.
  return {
    message: "No schools have a school paper on file yet.",
    narrowed: false,
  };
}
