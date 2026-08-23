import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import { distinctCoaches } from "@/lib/roster/entry-coaches";
import { surnameFirst } from "@/lib/roster/names";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import { matchesQuery } from "@/lib/search/matches-query";

/**
 * Which entries /admin/entries shows, what to say when that is none of them, and
 * what the workbook behind the Export button is called.
 *
 * Three call sites, one module, on purpose. The page renders the rows, the filter
 * bar counts the active params, and `app/admin/export/route.ts` builds the
 * spreadsheet — and the third one is why this file exists rather than the filter
 * staying inline where it was. The route used to repeat the page's predicate by
 * hand, so a filter added to one and not the other produced a download that
 * quietly disagreed with the screen it was taken from. A workbook outlives the tab
 * it came from; it is the copy the division files.
 *
 * A separate module from `app/entry/list-filters.ts`, which does the same job for
 * the school-facing lists: those rows are a different shape and this page's
 * dropdowns are not that toolbar's. `matchesQuery` is the piece both share.
 */

/**
 * The columns of an entry this module reads, and nothing else.
 *
 * Structural and deliberately minimal, because the page and the export route
 * select different things — the route also pulls middle names and genders for the
 * workbook — and both have to be filtered by the same code. Each caller keeps its
 * own row type and {@link filterEntryRows} hands that same type back; a select
 * that stops returning something named here fails at the call site rather than
 * silently narrowing to nothing.
 */
export interface AdminEntryRow {
  schools: { district_id: string } | null;
  events: {
    category: EventCategory;
    level: EventLevel;
    language: EventLanguage;
  } | null;
  entry_participants: {
    participants: { first_name: string; last_name: string } | null;
  }[];
  entry_coaches: {
    coaches: {
      id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    } | null;
  }[];
}

/**
 * Every key that narrows this page, in the order the filter bar shows them, with
 * the search first.
 *
 * The bar counts these for its "Clear N filters" label and this module reads the
 * same list, so a param cannot be filtered by one and uncounted by the other —
 * which is a reader looking at a narrowed table with no way back.
 */
export const ENTRY_FILTER_KEYS = [
  SEARCH_PARAM,
  "district",
  "school",
  "event",
  "category",
  "level",
  "language",
] as const;

/**
 * The params this page reads. All optional and all untrusted: they arrive off the
 * URL, so a hand-edited address can put anything in any of them.
 *
 * The search key is computed from {@link SEARCH_PARAM} rather than spelled `q`, so
 * this type cannot name a param the filter bar does not write. It is the one key
 * typed `string | string[]`, because that is what Next hands a page for `?q=a&q=b`
 * and the one value here that gets a string method called on it.
 *
 * `school` and `event` are in this list even though {@link filterEntryRows} does
 * not apply them: they narrow the Supabase read itself (`eq("school_id", …)`), in
 * the page and in the export route alike, so the rows are already filtered by the
 * time they get here. They still count as active filters below — the empty state
 * and the export filename both have to know the view is narrowed.
 */
export interface EntryFilters {
  [SEARCH_PARAM]?: string | string[];
  district?: string;
  school?: string;
  event?: string;
  category?: string;
  level?: string;
  language?: string;
}

/**
 * The filters as an object, read off a `URLSearchParams`.
 *
 * The export route gets its params as a `URLSearchParams` where the page gets a
 * plain object, and this is what keeps the two reading the same keys: the route
 * cannot misspell one, because it never names one. Typed against the single method
 * it needs, so both `URLSearchParams` and the read-only object `useSearchParams()`
 * returns satisfy it.
 *
 * `get` returns the first value of a repeated param, which is the same rule
 * {@link entrySearchQuery} applies to the array form the page receives — so
 * `?q=a&q=b` selects the same rows in the file as on the screen.
 */
export function entryFiltersFromParams(params: {
  get(key: string): string | null;
}): EntryFilters {
  const value = (key: string) => params.get(key) ?? undefined;

  return {
    [SEARCH_PARAM]: value(SEARCH_PARAM),
    district: value("district"),
    school: value("school"),
    event: value("event"),
    category: value("category"),
    level: value("level"),
    language: value("language"),
  };
}

/**
 * The search text as one string.
 *
 * `?q=cruz&q=reyes` arrives as `["cruz", "reyes"]`, and the first value wins
 * because that is what `useSearchParams().get(SEARCH_PARAM)` puts in the box —
 * the box and the table have to agree about which one they are showing. Handing
 * the array straight to `matchesQuery` would instead throw on `.trim()` and take
 * the page down over a URL anyone can type.
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
export function entrySearchQuery(filters: EntryFilters): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

/**
 * The contestants' names as the Participant(s) cell prints them.
 *
 * Exported so the page renders this and the search reads this, rather than the
 * cell formatting one way and the haystack another — a row would then match a
 * query with nothing on screen to show why. First and last name only, no middle
 * name, because that is the cell: the workbook's own surname-first column is a
 * different format for a different reader and is built in the route.
 */
export function entryParticipantNames(entry: AdminEntryRow): string[] {
  return entry.entry_participants
    .map((link) => link.participants)
    .filter((participant) => participant !== null)
    .map((participant) => `${participant.first_name} ${participant.last_name}`);
}

/**
 * The coaches' names as the Coach(es) cell prints them: distinct people, surname
 * first.
 *
 * `distinctCoaches` and not the link rows, for the same reason the cell uses it —
 * a coach who takes two contestants in one contest is two rows naming one person.
 */
export function entryCoachNames(entry: AdminEntryRow): string[] {
  return distinctCoaches(entry.entry_coaches).map((coach) => surnameFirst(coach));
}

/**
 * The dropdown filters, reduced to what they actually select.
 *
 * One place, read by the row filter, the empty state and the export filename, so
 * none of the three can disagree about whether the view is narrowed.
 *
 * Category, level and language are closed sets, so an unrecognised value is *no*
 * filter rather than a filter nothing matches — the rule `lib/paper/admin-papers.ts`
 * and `lib/roster/admin-coach-rows.ts` already follow, and worth more here than on
 * a page: `?level=elem` would otherwise hand an administrator an empty table, and
 * an empty workbook, that read as a division with no entries. District, school and
 * event are ids and cannot be checked that way; an id nothing matches is an empty
 * table, exactly as on /admin/participants.
 *
 * Search is the exception to all of it and is handled above: a typed query cannot
 * be unrecognised, so its empty result is the true answer.
 */
function activeRowFilters(filters: EntryFilters) {
  return {
    district: filters.district || null,
    school: filters.school || null,
    event: filters.event || null,
    category:
      filters.category === "individual" || filters.category === "group"
        ? filters.category
        : null,
    level:
      filters.level === "elementary" || filters.level === "secondary"
        ? filters.level
        : null,
    language:
      filters.language === "english" || filters.language === "filipino"
        ? filters.language
        : null,
  };
}

/**
 * The entries the page shows, in the order they came in.
 *
 * In memory rather than in the query: the read above it is a `fetchAll`, so every
 * row is already here — it has to be, or the "N of M" count lies — and narrowing
 * in the database would buy nothing while introducing a second matching semantics
 * beside `matchesQuery`, where a typed `%` became a wildcard and case and accents
 * behaved differently from the same query on every other list in this app.
 *
 * `school` and `event` are absent by design; see {@link EntryFilters}.
 */
export function filterEntryRows<T extends AdminEntryRow>(
  rows: T[],
  filters: EntryFilters
): T[] {
  const query = entrySearchQuery(filters) ?? "";
  const { district, category, level, language } = activeRowFilters(filters);

  return rows.filter((entry) => {
    // The people on the entry, in the form the table prints them: the contestants
    // and the coaches. They are what is left to type here — school, district,
    // event, category, level and language each have a dropdown of their own
    // directly above the table, and typing one of those would both duplicate a
    // precise control with a loose substring match and sweep in a whole bucket of
    // rows, which is the opposite of narrowing.
    //
    // Coaches are searchable because nothing else on this page can find them, and
    // because the school-facing list (`filterEntries` in
    // `app/entry/list-filters.ts`) has always searched them. Either way the match
    // is visible in a printed column.
    //
    // Nothing numeric is in here, because this table prints no number. The select
    // carries `participant_number` for no one to see, and `entries.entry_number`
    // is not read at all, so matching on either would put a row on screen for a
    // reason the screen does not show. If a number belongs in the search, it
    // belongs in a column first.
    //
    // Submitted is left out for the same "not a way to narrow" reason as the
    // dropdowns: it is a formatted timestamp, so "2026" is every entry.
    const haystack = [...entryParticipantNames(entry), ...entryCoachNames(entry)];
    if (!matchesQuery(haystack, query)) return false;

    // District, category, level and language live on joined tables, so they are
    // narrowed here rather than in the query.
    if (district && entry.schools?.district_id !== district) return false;
    if (category && entry.events?.category !== category) return false;
    if (level && entry.events?.level !== level) return false;
    if (language && entry.events?.language !== language) return false;
    return true;
  });
}

/**
 * Whether any control is narrowing the view.
 *
 * Computed from the controls and never from `shown < total`: a query that happens
 * to match every entry is still a filtered view, and the file it exports is still
 * not the whole division.
 */
export function entryFiltersActive(filters: EntryFilters): boolean {
  if (entrySearchQuery(filters) !== null) return true;
  return Object.values(activeRowFilters(filters)).some(Boolean);
}

export interface EntryEmptyState {
  /** What the table says in place of rows. Names the cause, never just "none". */
  message: string;
  /**
   * Whether the page owes the reader a way back to the full list. Driven off the
   * controls, so an empty table cannot offer a way back it cannot honour and a
   * query matching everything still gets one.
   */
  narrowed: boolean;
}

/**
 * What to render when the table has no rows.
 *
 * Four distinct facts, because "no entries" has four causes and a reader can only
 * act on the one that applies. A search that matches nothing is quoted back:
 * seeing the query is how someone spots the typo, and it is the difference between
 * "your search found nothing" and "no school has entered", which is a claim this
 * page must never make while 977 entries are on file.
 */
export function entryEmptyState(filters: EntryFilters): EntryEmptyState {
  const query = entrySearchQuery(filters);
  const otherFilters = Object.values(activeRowFilters(filters)).some(Boolean);

  if (query && otherFilters) {
    // Both named, because either alone might have matched and the reader gets to
    // choose which to drop.
    return {
      message: `No entries match “${query}” with these filters.`,
      narrowed: true,
    };
  }
  if (query) {
    return { message: `No entries match “${query}”.`, narrowed: true };
  }
  if (otherFilters) {
    // The wording this page has always used for this case.
    return { message: "No entries match these filters.", narrowed: true };
  }
  // Nothing is set, so the table itself is empty — before the first school files,
  // or if the read came back with nothing.
  return { message: "No entries have been submitted yet.", narrowed: false };
}

/**
 * What the exported workbook is called.
 *
 * The scope is in the name because the file outlives the screen: an administrator
 * who downloads one district's entries in March must not open it in June and read
 * it as the division's entry list. `-filtered-` is the whole claim — which filters
 * were set is not in the name, since six dropdowns plus a free-text query do not
 * fit in a filename and a half-told scope is worse than a flagged one.
 *
 * Derived from the same filters the rows were, so the name cannot say "filtered"
 * about an unfiltered sheet or stay quiet about a narrowed one.
 */
export function entriesExportFilename(filters: EntryFilters, date: string): string {
  const scope = entryFiltersActive(filters) ? "filtered-" : "";
  return `press-link-entries-${scope}${date}.xlsx`;
}
