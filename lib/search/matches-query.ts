/**
 * The one free-text predicate every searchable list in this app shares.
 *
 * It began in `app/entry/list-filters.ts`, where the three lists a school reads
 * used it; the admin tables above them ask exactly the same question of their
 * rows, so it lives here rather than being typed out again per page. Behaviour
 * is unchanged from that original: substring, case-insensitive, trimmed, and an
 * empty query filters nothing.
 *
 * A reader types the fragment they remember — half a surname, a number off a
 * form — so this matches anywhere in any of the fields rather than only at the
 * start. An empty box is no filter, and trailing spaces from a paste are not a
 * reason to show nothing.
 *
 * It is a substring test and not a word-set test: "cruz ana" finds nothing in
 * "Dela Cruz, Ana", because those two words are not adjacent in that order.
 * That is the deal the entry lists have always offered and no page has
 * complained; splitting the needle on spaces would make every multi-word query
 * match more rows, which is the opposite of what someone narrowing a list wants.
 *
 * Unlike every closed-union filter in `lib/` — where an unrecognised URL value
 * is treated as no filter rather than as a filter nothing matches — search is
 * the one filter whose empty result is a legitimate answer. See the note beside
 * `SEARCH_PARAM` in `./filter-params.ts` for what that obliges a page to render.
 */
export function matchesQuery(haystacks: string[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return haystacks.some((haystack) => haystack.toLowerCase().includes(needle));
}

/**
 * U+0300–U+036F, the Combining Diacritical Marks block. Written as code points
 * rather than as a regex escape so the range is legible: the characters
 * themselves are invisible in an editor, and `\p{Mn}` needs an ES2018 target
 * this project does not set.
 */
const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;

const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(COMBINING_MARKS_START)}-${String.fromCharCode(
    COMBINING_MARKS_END
  )}]`,
  "g"
);

/**
 * Drops the combining marks NFD splits off, so "Niño" folds to "Nino".
 *
 * Only marks in the Combining Diacritical Marks block are removed, which is what
 * NFD produces for every accented Latin letter these lists hold. The base letter
 * survives, so this is not transliteration: "ñ" becomes "n", and anything
 * outside that block is left exactly as it was.
 */
export function foldDiacritics(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * `matchesQuery` with accents ignored on both sides: "nino" finds "Niño", and
 * "niño" finds "Nino".
 *
 * Opt-in on purpose, and deliberately not what `matchesQuery` itself does.
 * Folding changes what a query matches, so it is not something to slip into a
 * predicate that three shipping lists already depend on. It is offered because
 * these are Filipino names — Niño, Peña, Muñoz are ordinary here — and a
 * keyboard with no ñ is just as ordinary, so a list that would rather be
 * generous than exact can ask for that by name at its own call site.
 *
 * Folding has to be symmetric to be any use: an admin who pastes "Peña" out of a
 * form should still find a row someone typed as "Pena". Both sides go through
 * `foldDiacritics` here for that reason — a caller folding only one side would
 * get a filter that works in one direction and quietly fails the other.
 */
export function matchesQueryIgnoringDiacritics(
  haystacks: string[],
  query: string
): boolean {
  return matchesQuery(haystacks.map(foldDiacritics), foldDiacritics(query));
}
