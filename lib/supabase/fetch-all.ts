/**
 * PostgREST caps a response at a fixed number of rows (`db-max-rows`), so a single
 * `select` over a table that can grow past that cap returns a **silently truncated**
 * answer — no error, no flag, just fewer rows than exist.
 *
 * That is fatal rather than merely slow. Dropped `judge_ranks` rows do not make a
 * board look smaller — they make it look *unfinished*, because `consolidateRound`
 * counts what is missing. A truncated read would report a panel that has finished as
 * still working, and would keep the round-1 close button greyed out for an event that
 * was ready. The admin list pages fail one step earlier and just as quietly: a heading
 * that reads "1000 listed" over a roster of 2,273 is not a slow page, it is a wrong
 * fact with nothing on screen to contradict it.
 *
 * So every table whose size follows the data is read a page at a time, and running
 * past the ceiling raises instead of returning a short answer.
 *
 * ## Two conditions on the caller
 *
 * **`PAGE_SIZE` must not exceed the project's `db-max-rows`.** If the server's ceiling
 * is lower, it clips a full window into a short one, and a clipped page is
 * indistinguishable from the last page — this loop would stop there and reproduce the
 * exact bug it exists to prevent. 1000 is PostgREST's own default and Supabase's; a
 * project that lowers it has to lower this to match.
 *
 * **The paged query needs a deterministic total order.** `LIMIT/OFFSET` over a
 * non-unique `ORDER BY` lets Postgres place tied rows differently between two
 * requests, which drops some across a page boundary and repeats others. Any ordering
 * that is not already unique needs a tiebreaker — `.order("id")` last. Migration 0018
 * makes the same argument for the same reason when it numbers entries by
 * `(submitted_at, id)`.
 */
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 60;

/** Thrown by {@link fetchAll} so one `catch` can turn any failed read into `error`. */
export class LoadFailure extends Error {}

/**
 * Every row of `page`, read a window at a time.
 *
 * Takes a callback rather than a query builder because a PostgREST builder carries the
 * `Range` header it was given: the query has to be rebuilt per window, and only the
 * caller knows its shape. `what` names the read in the message a failure produces, so
 * a page can say which list it could not draw.
 */
export async function fetchAll<T>(
  what: string,
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];

  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new LoadFailure(`${what} could not be read: ${error.message}`);

    const batch = data ?? [];
    out.push(...batch);
    // A short page is the last page. An exactly-full one may not be, so it is
    // followed by one more request that comes back empty.
    if (batch.length < PAGE_SIZE) return out;
  }

  throw new LoadFailure(
    `${what} runs past ${MAX_PAGES * PAGE_SIZE} rows, which is more than this page reads in one go. Reporting it rather than showing a partial count.`
  );
}
