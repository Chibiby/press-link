import { matchesQuery } from "@/lib/search/matches-query";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import type { AdminParticipantRow } from "./admin-rows";

/**
 * Which rows /admin/participants shows, and what to say when that is none of
 * them.
 *
 * The sibling lists already keep this beside their row mapper —
 * `filterCoachRows` in `./admin-coach-rows.ts`, `filterSchoolPaperRows` in
 * `@/lib/paper/admin-papers.ts` — and the participants page was the one that
 * still filtered inline in its component. Inline is why the page could not be
 * tested: every test in this repo runs under `environment: "node"`, so anything
 * left inside an async server component is permanently unreachable. This file is
 * that page's missing half, and it is a separate module from `./admin-rows.ts`
 * only because the mapper there is about shaping a Supabase row while this is
 * about reading a URL.
 */

/**
 * The params this page reads. Every field is optional and untrusted: these
 * arrive off the URL, so a hand-edited address can put anything in any of them.
 *
 * The search key is computed from {@link SEARCH_PARAM} rather than written as
 * `q`, so this type cannot name a param the filter bar does not write. It is the
 * one key typed `string | string[]`, because that is what Next hands a page for
 * `?q=a&q=b` and it is the one value here that gets a string method called on it.
 */
export interface ParticipantFilters {
  [SEARCH_PARAM]?: string | string[];
  district?: string;
  school?: string;
  multi?: string;
  unassigned?: string;
}

/**
 * The search text as one string.
 *
 * `?q=cruz&q=reyes` resolves to `["cruz", "reyes"]`, and the first value wins
 * because that is what `useSearchParams().get(SEARCH_PARAM)` returns in the
 * filter bar above — the box and the table have to agree about which one they
 * are showing. Handing the array straight to `matchesQuery` would instead throw
 * on `.trim()` and take the whole page down over a malformed URL.
 */
function firstValue(raw: string | string[] | undefined): string {
  if (raw === undefined) return "";
  if (Array.isArray(raw)) return raw.length > 0 ? raw[0] : "";
  return raw;
}

/**
 * The typed query, trimmed, or null when the box is empty — the same "trimmed,
 * and absent rather than empty" rule the bar applies before it writes to the
 * URL, so `?q=%20%20` narrows nothing here just as it counts as nothing there.
 */
export function participantSearchQuery(filters: ParticipantFilters): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

/**
 * The dropdown and toggle filters, reduced to what they actually select.
 *
 * One place, read by both the row filter and the empty state, so the two cannot
 * disagree about whether the list is being narrowed. An unrecognised value is no
 * filter rather than a filter nothing matches — `?multi=yes` shows the full
 * roster, matching `filterCoachRows` and `filterSchoolPaperRows`, because a
 * mistyped URL should not present an empty table as if the division had no
 * learners. Search is the exception to that rule and is handled above: a typed
 * query cannot be unrecognised, so its empty result is the true answer.
 */
function activeRowFilters(filters: ParticipantFilters) {
  return {
    district: filters.district || null,
    school: filters.school || null,
    multiOnly: filters.multi === "1",
    unassignedOnly: filters.unassigned === "1",
  };
}

export function filterParticipantRows(
  rows: AdminParticipantRow[],
  filters: ParticipantFilters
): AdminParticipantRow[] {
  const query = participantSearchQuery(filters) ?? "";
  const { district, school, multiOnly, unassignedOnly } = activeRowFilters(filters);

  return rows.filter((row) => {
    // The three things a reader has in front of them when they go looking: the
    // name, the school, and the number off the form. `displayNumber` and not
    // `numberLabel`, so the asterisk a multi-event row is printed with survives
    // a copy-paste of the cell — "*0007" and "0007" both find row 7, since the
    // match is a substring test either way.
    //
    // District is deliberately not searchable: it has its own dropdown right
    // above the table, and typing "District I" would sweep in a third of the
    // roster, which is the opposite of narrowing.
    if (!matchesQuery([row.fullName, row.schoolName, row.displayNumber], query)) {
      return false;
    }
    if (district && row.districtId !== district) return false;
    if (school && row.schoolId !== school) return false;
    if (multiOnly && !row.isMultiEvent) return false;
    // Same param and same meaning as /admin/coaches?unassigned=1: registered but
    // on no entry.
    if (unassignedOnly && row.eventCount > 0) return false;
    return true;
  });
}

export interface ParticipantEmptyState {
  /** What the table says in place of rows. Names the cause, never just "none". */
  message: string;
  /**
   * Whether a control is narrowing the list, and so whether the page owes the
   * reader a way back to the full roster.
   *
   * Driven off the controls, not off `shown < total`, the way
   * `app/entry/ListToolbar.tsx` does it — an empty roster and a query that
   * matches nothing are two different facts, and only one of them has a way out.
   */
  narrowed: boolean;
}

/**
 * What to render when the table has no rows.
 *
 * Four distinct facts, because "no rows" has four causes and a reader can only
 * act on the one that applies to them. A search that matches nothing is quoted
 * back: seeing the query is how someone spots the typo, and it is the difference
 * between "your search found nobody" and "there are no learners", which is a
 * claim this page must never make while 2,273 of them are on file.
 */
export function participantEmptyState(
  filters: ParticipantFilters
): ParticipantEmptyState {
  const query = participantSearchQuery(filters);
  const otherFilters = Object.values(activeRowFilters(filters)).some(Boolean);

  if (query && otherFilters) {
    return {
      // Both are named, because either one alone might have matched and the
      // reader gets to choose which to drop.
      message: `No participants match “${query}” with these filters.`,
      narrowed: true,
    };
  }
  if (query) {
    return {
      message: `No participants match “${query}”.`,
      narrowed: true,
    };
  }
  if (otherFilters) {
    return { message: "No participants match these filters.", narrowed: true };
  }
  // Nothing is set, so the roster itself is empty — before the first school
  // registers, or if the read came back with nothing.
  return { message: "No participants are registered yet.", narrowed: false };
}
