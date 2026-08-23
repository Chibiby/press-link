/**
 * The URL half of the admin filter bars: the param names, and the pure rules for
 * turning "the reader changed this control" into the next query string.
 *
 * Every bar wrote these eleven lines out by hand, differing only in the path they
 * pushed to, which is how `unassigned` came to be missing from one bar's Clear
 * count (see `app/admin/(shell)/participants/ParticipantFilterBar.tsx`). The
 * React wiring lives in `hooks/use-filter-params.ts`; the rules live here so they
 * can be tested under `environment: "node"`, where no hook can run.
 *
 * Nothing in this file imports React or `next/navigation`, so a server component
 * can read `SEARCH_PARAM` from it. That is the reason the constant is not next to
 * the hook: `hooks/use-filter-params.ts` is a `"use client"` module, and a value
 * imported from one of those into a server component is a client reference, not
 * the string `"q"`.
 */

/**
 * The free-text search param, for every admin list. `q` because the existing
 * params are short, singular, lowercase nouns — `district`, `school`, `event`,
 * `status`, `lock`, `language` — and `q` is the one the whole web already reads
 * as "the search box". Import it; a page that spells it out in a string literal
 * is a page that can disagree with its own filter bar.
 *
 * **This is the one filter whose empty result is a legitimate answer.** Every
 * other filter here is a closed set — `lib/dashboard/school-registry.ts` keeps
 * `status` as a union "rather than a free-text query param so a mistyped URL
 * cannot produce a table nobody can explain", and `lib/paper/admin-papers.ts`
 * and `lib/roster/admin-coach-rows.ts` both treat an unrecognised value as *no*
 * filter rather than as a filter nothing matches. A typed query cannot be
 * unrecognised: "qwerty" matching no learner is the true answer, and the page
 * must say so.
 *
 * So a page wiring this up owes its reader two things when the search empties the
 * table: a message that names the cause — "No rows match your search", not "no
 * learners yet" — and a way back to the full list. Drive that way back off the
 * controls and not off `shown < total`, the way `app/entry/ListToolbar.tsx` does:
 * a query that happens to match every row still needs a visible way out.
 */
export const SEARCH_PARAM = "q";

/**
 * How long the search box waits before it writes to the URL.
 *
 * These lists are async server components, so each write is a server render and
 * a fresh query, not a client-side filter. Firing per keystroke would spend
 * "cruz" on four of them and land the first three on values nobody asked about.
 *
 * 250ms sits in the gap between the two things a delay can be wrong about. A
 * steady typist leaves 150–200ms between keys, so 250ms reliably waits for the
 * end of a word rather than cutting in mid-word; and it is under the ~300ms mark
 * where a pause starts to read as the page being slow rather than as the page
 * being polite. The box itself never waits — see the hook: the visible value is
 * local state and only the URL write is held back.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * The next query string after one control changed.
 *
 * Same rules the bars each wrote by hand: a value sets its key, no value deletes
 * it, and `clearKeys` deletes the params that cannot hold at the same time as
 * this one — "in more than one event" and "in no event", say. Key order is
 * whatever `URLSearchParams` does with it, which is what the bars already
 * produced: `set` replaces a key in place, and a new key goes on the end.
 *
 * The "no filter" sentinel that Radix forces on the selects (`ANY`) is not known
 * here on purpose. It exists because a `SelectItem` cannot have an empty value —
 * a fact about a dropdown, not about a URL — so the hook translates it to `null`
 * before calling this, and this file stays honest about what it is: a query
 * string in, a query string out.
 */
export function nextFilterQuery(
  current: string,
  key: string,
  value: string | null,
  clearKeys: readonly string[] = []
): string {
  const params = new URLSearchParams(current);

  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }

  for (const clearKey of clearKeys) {
    params.delete(clearKey);
  }

  return params.toString();
}

/**
 * Where a filter change navigates to. The bare path when nothing is set, so
 * clearing the last filter leaves `/admin/participants` and not
 * `/admin/participants?` — exactly what the bars did with their hardcoded
 * strings, except the path now comes from `usePathname()`.
 */
export function filterHref(pathname: string, query: string): string {
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * What the search box's text should be in the URL: trimmed, and absent rather
 * than empty.
 *
 * Backspacing the box to nothing has to remove the param, not leave `?q=`. A
 * lingering empty param would count as an active filter in `countActiveParams`
 * and keep the Clear button on screen with nothing left to clear.
 *
 * Trimming here means the URL is the tidy form of what was typed while the box
 * keeps the spaces the reader typed. `matchesQuery` trims too, so both spellings
 * of the query select the same rows either way.
 */
export function searchParamValue(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * How many of `keys` are set, which is what the bars' "Clear N filters" counts.
 *
 * Typed against the one method it needs so both `URLSearchParams` and the
 * read-only object `useSearchParams()` returns satisfy it. An empty value does
 * not count — `?q=` is not a filter — which is the behaviour of the
 * `FILTER_KEYS.filter((k) => searchParams.get(k)).length` line it replaces.
 *
 * A bar with a search box has to include `SEARCH_PARAM` in its keys. Leaving it
 * out is the bug the participants bar already had once with `unassigned`: a
 * reader arrives on a filtered table with no Clear button and no way back.
 */
export function countActiveParams(
  params: { get(key: string): string | null },
  keys: readonly string[]
): number {
  return keys.filter((key) => Boolean(params.get(key))).length;
}
