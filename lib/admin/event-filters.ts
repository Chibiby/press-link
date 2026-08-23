import type { EventMatrixRow } from "@/lib/dashboard/event-matrix";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import { matchesQuery } from "@/lib/search/matches-query";

/**
 * Which contest types /admin/events lists, and what to say when a section holds
 * none of them.
 *
 * The shape follows `lib/roster/participant-filters.ts` and
 * `lib/admin/overall-data-filters.ts` — an `XFilters`, a `filterXRows`, an
 * `xEmptyState` — because these are the same page mechanics and the second copy
 * of a pattern is where the two drift. It is separate from
 * `lib/dashboard/event-matrix.ts` because that file folds 56 event slots into 16
 * type rows and this one reads a URL; keeping it here is also the only way it can
 * be tested, since every test in this repo runs under `environment: "node"` and
 * nothing left inside the async server component is reachable from one.
 *
 * ## What this deliberately does not narrow
 *
 * The heading's badge and subtitle — "56 events across 16 contest types" — are
 * facts about the catalogue, not counts of the table, so they are computed from
 * the unsearched matrix and left alone. There is likewise no `fetchAll` and no
 * "N of M" row count: the catalogue is a fixed 56 rows read in one unpaged
 * select, nowhere near PostgREST's row cap, so a count framed as protection
 * against truncation would answer a risk this page does not have. The per-section
 * card descriptions *are* counts of the table, and {@link eventTypeCountLabel}
 * keeps them honest while the search is on.
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
export interface EventFilters {
  [SEARCH_PARAM]?: string | string[];
}

/**
 * The search text as one string.
 *
 * `?q=news&q=sports` resolves to `["news", "sports"]`, and the first value wins
 * because that is what `useSearchParams().get(SEARCH_PARAM)` returns in the box —
 * the input and the two tables have to agree about which one they are showing.
 * Handing the array straight to `matchesQuery` would instead throw on `.trim()`
 * and take the page down over a URL anyone can type.
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
export function eventSearchQuery(filters: EventFilters): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

export function filterEventRows(
  rows: EventMatrixRow[],
  filters: EventFilters
): EventMatrixRow[] {
  const query = eventSearchQuery(filters) ?? "";

  // Both names, because the row prints both: the English name on the first line
  // and the Filipino one under it, so "lathalain" has to find Feature Writing
  // just as "feature" does. Group contests and MOJO carry identical labels in the
  // source workbook and the page suppresses the duplicate second line; searching
  // the field anyway costs nothing, since a match on either is the same match.
  //
  // Three things on screen are deliberately not in here:
  //
  // - **Category.** It is the card heading, not a cell, and the two categories
  //   are already separate tables with their own headings. Typing "group" would
  //   not narrow anything — it would empty the Individual table while its heading
  //   still stood above it, which is navigation dressed up as a filter.
  // - **Level and language.** "Elem · Eng" is a column header, an axis of the
  //   matrix rather than a value on any row. A row is not *at* a level; it is
  //   offered at some of four slots, which is what the em dashes already say.
  // - **Team size and the entry counts.** Numbers. "7" would sweep in every group
  //   contest at once, the same reason the roster search leaves its count columns
  //   out.
  return rows.filter((row) => matchesQuery([row.typeNameEn, row.typeNameFil], query));
}

/** Which of the page's two tables an empty state is being written for. */
export type EventSection = "individual" | "group";

/**
 * How a section names one of its rows in a sentence. "contest" and not "event":
 * a row here is a contest type, and the page reserves "events" for the 56 slots
 * counted in the heading above.
 */
const SECTION_NOUN: Record<EventSection, string> = {
  individual: "individual contest",
  group: "group contest",
};

export interface EventEmptyState {
  /** What the table says in place of rows. Names the cause, never just "none". */
  message: string;
  /**
   * Whether the search is narrowing this section, and so whether the page owes
   * the reader a way back to the whole catalogue.
   *
   * Driven off the control and not off `shown < total`: a query matching every
   * type still needs a visible way out, and a catalogue that failed to load a
   * section must not offer a way back it cannot honour.
   */
  narrowed: boolean;
}

/**
 * What to render when one of the two tables has no rows.
 *
 * Two causes rather than the four the participants list has, because this page
 * has one control. It is per section on purpose: a query for "news" legitimately
 * empties the Group table while filling the Individual one, and a shared sentence
 * would have to say "no contest matches" under a heading that had just listed
 * nine of them.
 */
export function eventEmptyState(
  filters: EventFilters,
  section: EventSection
): EventEmptyState {
  const query = eventSearchQuery(filters);
  const noun = SECTION_NOUN[section];

  if (query) {
    // Quoted back, because seeing the query is how someone spots the typo — and
    // it keeps this well clear of "the division runs no group contests", which is
    // a claim this page must never make about a fixed catalogue.
    return { message: `No ${noun} matches “${query}”.`, narrowed: true };
  }
  return { message: `No ${noun} is in the catalogue.`, narrowed: false };
}

/**
 * The count that opens a section's description, pluralised.
 *
 * Computed from the rows actually shown rather than from the whole category: a
 * card reading "10 types" above a single searched row is a footer-style
 * disagreement between a caption and the table under it. The heading's own
 * figures stay catalogue-wide, so nothing here hides how big the catalogue is.
 */
export function eventTypeCountLabel(count: number): string {
  return `${count} type${count === 1 ? "" : "s"}`;
}

/** This page's path, so the search box and the way-back links cannot disagree. */
export const EVENTS_PATH = "/admin/events";
