import type { DistrictRollup } from "@/lib/dashboard/per-district";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import { matchesQuery } from "@/lib/search/matches-query";

/**
 * Which districts /admin/districts lists, and what to say when that is none of
 * them.
 *
 * The shape follows `lib/roster/participant-filters.ts` and
 * `lib/admin/overall-data-filters.ts` — an `XFilters`, a `filterXRows`, an
 * `xEmptyState` — because these are the same page mechanics and the second copy
 * of a pattern is where the two drift.
 *
 * It is a separate module from `lib/dashboard/per-district.ts` for the same
 * reason the roster filter is separate from `admin-rows.ts`: that file is about
 * folding schools into rollups, this one is about reading a URL. It is also the
 * only way either half can be tested — every test here runs under
 * `environment: "node"`, so anything left inside the async server component is
 * permanently unreachable.
 *
 * ## What this deliberately does not narrow
 *
 * `summarisePerDistrict` returns `totals` alongside `rows`, and the page prints
 * them in a `TableFooter` labelled "Division". Those are population figures — the
 * numbers read out in meetings — so the page summarises the *unsearched* set and
 * replaces only `rows`, exactly as /admin/overall-data does with its per-school
 * panel. A footer computed from a searched array would be "the total of what I
 * typed" under a heading that says Division. {@link districtTotalsLabel} is how
 * that footer says so out loud while the table is narrowed.
 *
 * There is also no `fetchAll` here and no "N of M" badge, on purpose. This table
 * is the division roll — 23 rows — read in one unpaged select that cannot reach
 * PostgREST's row cap, so a count framed as protection against truncation would
 * be answering a risk this page does not have.
 */

/**
 * The params this page reads. One field, optional and untrusted: it arrives off
 * the URL, so a hand-edited address can put anything in it.
 *
 * The key is computed from {@link SEARCH_PARAM} rather than written as `q`, so
 * this type cannot name a param the search box does not write. It is typed
 * `string | string[]` because that is what Next hands a page for `?q=a&q=b`, and
 * it is the one value here a string method is called on.
 */
export interface DistrictFilters {
  [SEARCH_PARAM]?: string | string[];
}

/**
 * The search text as one string.
 *
 * `?q=alabel&q=malungon` resolves to `["alabel", "malungon"]`, and the first
 * value wins because that is what `useSearchParams().get(SEARCH_PARAM)` returns
 * in the box — the input and the table have to agree about which one they are
 * showing. Handing the array straight to `matchesQuery` would instead throw on
 * `.trim()` and take the page down over a URL anyone can type.
 */
function firstValue(raw: string | string[] | undefined): string {
  if (raw === undefined) return "";
  if (Array.isArray(raw)) return raw.length > 0 ? raw[0] : "";
  return raw;
}

/**
 * The typed query, trimmed, or null when the box is empty — the same "trimmed,
 * and absent rather than empty" rule the box applies before it writes to the URL,
 * so `?q=%20%20` narrows nothing here just as it counts as nothing there.
 */
export function districtSearchQuery(filters: DistrictFilters): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

export function filterDistrictRows(
  rows: DistrictRollup[],
  filters: DistrictFilters
): DistrictRollup[] {
  const query = districtSearchQuery(filters) ?? "";

  // The name, and only the name. It is the one text column the table prints —
  // the other seven cells are counts, and matching those would turn "3" into an
  // arbitrary handful of rows rather than a narrowing. The trailing cell is a
  // link to that district's schools, whose visible text is the same word on
  // every row, so there is nothing there to search either.
  return rows.filter((row) => matchesQuery([row.districtName], query));
}

export interface DistrictEmptyState {
  /** What the table says in place of rows. Names the cause, never just "none". */
  message: string;
  /**
   * Whether the search is narrowing the list, and so whether the page owes the
   * reader a way back to the full roll.
   *
   * Driven off the control and not off `shown < total`: a query matching every
   * district still needs a visible way out, and an empty roll must not offer a
   * way back it cannot honour.
   */
  narrowed: boolean;
}

/**
 * What to render when the table has no rows.
 *
 * Two causes rather than the four the participants list has, because this page
 * has one control: either the search is hiding everything, or the roll itself is
 * empty. A search that matches nothing is quoted back — seeing the query is how
 * someone spots the typo — and it is kept well clear of "there are no districts",
 * which is a claim this page must never make while 23 of them are on file.
 */
export function districtEmptyState(filters: DistrictFilters): DistrictEmptyState {
  const query = districtSearchQuery(filters);

  if (query) {
    return { message: `No district matches “${query}”.`, narrowed: true };
  }
  // Nothing is typed, so the roll itself came back empty — before the school
  // workbook is seeded, or if the read returned nothing.
  return { message: "No districts are on the division roll.", narrowed: false };
}

/**
 * The label on the footer row of totals.
 *
 * The footer is always the whole division, never the sum of what is on screen —
 * see the note at the top of this file. Unlabelled, that is a trap: a table
 * footer reads as a sum of the column above it, so a reader who has narrowed to
 * four districts would see four rows and a total five times larger and conclude
 * the search is broken. Naming the scope costs four words and removes the
 * misreading; the alternatives are a footer that silently disagrees with the rows
 * or a division figure that quietly changes meaning under a label that did not.
 */
export function districtTotalsLabel(
  filters: DistrictFilters,
  totalDistricts: number
): string {
  if (districtSearchQuery(filters) === null) return "Division";
  return `Division (all ${totalDistricts} district${totalDistricts === 1 ? "" : "s"})`;
}

/** This page's path, so the search box and the way-back link cannot disagree. */
export const DISTRICTS_PATH = "/admin/districts";
