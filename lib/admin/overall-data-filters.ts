import type { SchoolRollupRow } from "@/lib/dashboard/per-school";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import { matchesQuery } from "@/lib/search/matches-query";

/**
 * Which schools the per-school panel on /admin/overall-data lists, and what to
 * say when that is none of them.
 *
 * ## Why this is a row filter and nothing else
 *
 * That page carries two kinds of figure. The per-school panel is a list: one row
 * per school with data, and a reader goes looking in it for a school by name.
 * Everything else on the page — the division total row under that list, the
 * registered-school denominator, the entries-by-event-type table and its Total —
 * is a *population* figure, and those are the numbers read out in meetings.
 *
 * So the search implemented here narrows `SchoolRollupRow[]` and touches nothing
 * else. `summarisePerSchool` computes `totals` from the array handed to it, which
 * means a searched array handed to it would quietly produce "total of what I
 * typed" under a heading that says "Division total". The page therefore summarises
 * the *unsearched* set and replaces only `rows`; see the comment at that call.
 *
 * The shape follows `lib/roster/participant-filters.ts` — an `XFilters`, a
 * `filterXRows`, an `xEmptyState` — because these are the same page mechanics and
 * the second copy of a pattern is where the two drift.
 */

/**
 * The params this page reads. Both optional and both untrusted: they arrive off
 * the URL, so a hand-edited address can put anything in either.
 *
 * The search key is computed from {@link SEARCH_PARAM} rather than written as
 * `q`, so this type cannot name a param the filter bar does not write. It is the
 * one field typed `string | string[]`, because that is what Next hands a page for
 * `?q=a&q=b` and it is the one value here a string method is called on.
 */
export interface OverallDataFilters {
  [SEARCH_PARAM]?: string | string[];
  district?: string;
}

/**
 * The search text as one string.
 *
 * `?q=rizal&q=bagumbayan` resolves to an array, and the first value wins because
 * that is what `useSearchParams().get(SEARCH_PARAM)` returns in the filter bar —
 * the box and the list have to agree about which one they are showing. Handing
 * the array to `matchesQuery` would instead throw on `.trim()` and take the page
 * down over a URL anyone can type.
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
export function overallDataSearchQuery(filters: OverallDataFilters): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

/** The district selection, or null. `?district=` is no filter, not a filter nothing matches. */
function districtFilter(filters: OverallDataFilters): string | null {
  return filters.district || null;
}

/**
 * The rows the per-school panel lists.
 *
 * `district` is applied here as well as by the callers, and that repetition is
 * deliberate: the callers *must* narrow before they summarise, because a district
 * selection is meant to move the totals and the denominator with it, which a row
 * filter cannot do. Re-applying it here is then a no-op on their input and makes
 * this function the single answer to "is this row shown", so the empty state below
 * cannot disagree with the list.
 *
 * The search is not applied before the summary anywhere, for the opposite reason:
 * it must *not* move the totals.
 */
export function filterOverallDataRows(
  rows: SchoolRollupRow[],
  filters: OverallDataFilters
): SchoolRollupRow[] {
  const query = overallDataSearchQuery(filters) ?? "";
  const district = districtFilter(filters);

  return rows.filter((row) => {
    // The school name, and only the school name.
    //
    // District is excluded because it has its own dropdown directly above this
    // table: typing "District I" would sweep in a third of the division, which is
    // the opposite of narrowing, and a typed district that disagreed with the
    // dropdown would be two controls fighting over one column.
    //
    // Learners, coaches and entries are excluded because they are quantities, not
    // identifiers. "12" is not a school anyone is looking for, and matching it
    // against three count columns would return an arbitrary handful of rows.
    if (!matchesQuery([row.schoolName], query)) return false;
    if (district && row.districtId !== district) return false;
    return true;
  });
}

export interface OverallDataEmptyState {
  /** What the panel says in place of rows. Names the cause, never just "none". */
  message: string;
  /**
   * Whether a control is narrowing the list, and so whether the page owes the
   * reader a way back.
   *
   * Driven off the controls and not off `shown < activeSchools`: a query that
   * happens to match every school still needs a visible way out, and a division
   * with no active school at all must not offer a way back it cannot honour.
   */
  narrowed: boolean;
  /** The label for that way back, so the wording and the href are decided together. */
  resetLabel: string;
}

/**
 * What to render in place of the per-school table when nothing is listed.
 *
 * Four causes, and a reader can only act on the one that applies to them. A
 * search that matches nothing is quoted back — seeing the query is how someone
 * spots the typo — and it is kept well clear of "no school has registered
 * anything yet", which is a claim this page must never make while two dozen
 * schools are on file.
 */
export function overallDataEmptyState(
  filters: OverallDataFilters
): OverallDataEmptyState {
  const query = overallDataSearchQuery(filters);
  const district = districtFilter(filters);

  if (query && district) {
    return {
      // Both causes named, because either one alone might have matched and the
      // reader gets to choose which to drop. The way back drops the search and
      // keeps the district: clearing the district would also move every total on
      // the page, which is more than was asked for.
      message: `No school in the selected district matches “${query}”.`,
      narrowed: true,
      resetLabel: "Show all schools in this district",
    };
  }
  if (query) {
    return {
      message: `No school matches “${query}”.`,
      narrowed: true,
      resetLabel: "Show all schools",
    };
  }
  if (district) {
    return {
      message:
        "No school in the selected district has registered a learner, a coach or an entry yet.",
      narrowed: true,
      resetLabel: "Show all districts",
    };
  }
  // Nothing is set, so there is genuinely nothing to list.
  return {
    message: "No school has registered a learner, a coach or an entry yet.",
    narrowed: false,
    resetLabel: "Show all schools",
  };
}

/**
 * The line under the panel heading: how many schools are listed out of how many
 * have data, and — when a search is on — that the total underneath is not the sum
 * of them.
 *
 * The count is against `activeSchools` off the summary, never against the length of
 * the listed array, so a narrowed list cannot be mistaken for the size of the set.
 * The second sentence exists because the footer of that table says "Division
 * total" and means it: with a search on, the rows above it do not add up to it, and
 * a spreadsheet-minded reader checking the arithmetic deserves to be told why
 * rather than to conclude a number is wrong.
 */
export function overallDataListDescription(
  filters: OverallDataFilters,
  counts: { shown: number; activeSchools: number }
): string {
  const query = overallDataSearchQuery(filters);
  const { shown, activeSchools } = counts;

  if (activeSchools === 0) {
    return "No school in this selection has registered anything yet.";
  }
  if (!query) return `All ${activeSchools}, biggest first.`;
  // The query is not quoted here, because the message in place of the rows is about
  // to quote it a line below. This half's job is the figure that message cannot
  // carry: how many schools have data at all, which is what stops "none match" from
  // reading as "there is nothing here".
  if (shown === 0) return `${activeSchools} schools have data. None of them match.`;
  return `${shown} of ${activeSchools} match “${query}”, biggest first. The division total counts all ${activeSchools}.`;
}

/** This page's path, so the reset link and the export link cannot disagree about it. */
export const OVERALL_DATA_PATH = "/admin/overall-data";

/**
 * Where the way-back link goes: the search dropped, the district kept.
 *
 * Not the bare path. The district selection is upstream of every total on the
 * page, so throwing it away to escape a search would silently re-scope figures
 * the reader was not complaining about. The one case that does clear it is a
 * district with no active school at all, where the district *is* the thing to
 * escape — `resetLabel` says which of the two is on offer.
 */
export function overallDataResetHref(filters: OverallDataFilters): string {
  const district = districtFilter(filters);
  const keepDistrict = district !== null && overallDataSearchQuery(filters) !== null;
  return keepDistrict
    ? `${OVERALL_DATA_PATH}?district=${encodeURIComponent(district)}`
    : OVERALL_DATA_PATH;
}

/** Longest slug the filename carries, so a pasted paragraph cannot become the name. */
const FILENAME_QUERY_MAX = 24;

/**
 * The export's filename, marked when the workbook is a filtered view.
 *
 * A sheet of a handful of schools named like the full division gets forwarded as
 * the full division. The base name is unchanged when nothing is searched, so an
 * unfiltered export still lands under the name officers already have on file.
 *
 * The query is slugged down to `[a-z0-9-]` rather than escaped, and that is a
 * safety boundary and not tidiness: this string goes into a `Content-Disposition`
 * header, where a quote or a CRLF out of a hand-edited URL would end the filename
 * and start something else. Anything that slugs away to nothing — a query of
 * punctuation, or of characters outside ASCII — still gets the word "filtered",
 * because the fact that matters is that the sheet is narrowed, not what was typed.
 */
export function overallDataExportFilename(
  filters: OverallDataFilters,
  date: string
): string {
  const query = overallDataSearchQuery(filters);
  if (!query) return `press-link-overall-data-${date}.xlsx`;

  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, FILENAME_QUERY_MAX)
    .replace(/-+$/, "");

  return `press-link-overall-data-filtered-${slug || "search"}-${date}.xlsx`;
}
