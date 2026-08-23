/**
 * Fifty participants is a long list to walk past, and on a phone it used to put
 * the entries a whole screen of scrolling below the roster. The lists are paged
 * instead: ten rows by default, with the school free to ask for more.
 *
 * Every row is already on the client, so a page is a slice — no round trip, and
 * a search still searches the whole list rather than the page you can see.
 */

/**
 * What a school may ask to see at once. Ten first because that is the size that
 * keeps a roster short enough for the entries to stay in view under it.
 */
export const PAGE_SIZES = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

/** A break in the page numbers, drawn as an ellipsis. */
export const GAP = "gap";

export type PageSlot = number | typeof GAP;

/** Always at least one page, so an empty list still has a page 1 to be on. */
export function pageCount(total: number, size: number): number {
  if (size <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(total, 0) / size));
}

/**
 * The page a school can actually be on. A filter that narrows the list, or a
 * removed last row, leaves the stored page past the end; that must land on the
 * new last page rather than on nothing at all.
 */
export function clampPage(page: number, total: number, size: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), pageCount(total, size));
}

export function pageSlice<T>(items: T[], page: number, size: number): T[] {
  if (size <= 0) return items;
  const start = (clampPage(page, items.length, size) - 1) * size;
  return items.slice(start, start + size);
}

/** "1–10 of 50" — where you are, and how much there is. */
export function rangeLabel(page: number, total: number, size: number): string {
  if (total <= 0) return "Nothing to show";
  const current = clampPage(page, total, size);
  const first = (current - 1) * size + 1;
  return `${first}–${Math.min(first + size - 1, total)} of ${total}`;
}

/**
 * The page numbers to draw, with gaps where numbers were left out.
 *
 * Exactly `slots` of them, gaps included, because at 320px the row has room for
 * five 32px buttons between Previous and Next and no more. The first and last
 * pages always keep their place — they are the two a school jumps to — and the
 * numbers in between give way to a gap. Prev and Next carry single steps, so
 * losing a neighbour to a gap costs nothing.
 */
export function pageSlots(page: number, count: number, slots = 5): PageSlot[] {
  const last = Math.max(1, Math.trunc(count));
  const room = Math.max(5, Math.trunc(slots));
  const current = clampPage(page, last, 1);
  const run = (from: number, length: number) =>
    Array.from({ length }, (_, i) => from + i);

  if (last <= room) return run(1, last);

  // One slot for the far page, one for the gap beside it.
  const edge = room - 2;
  if (current <= edge) return [...run(1, edge), GAP, last];
  if (current > last - edge) return [1, GAP, ...run(last - edge + 1, edge)];
  return [1, GAP, current, GAP, last];
}
