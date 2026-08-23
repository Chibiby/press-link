import { describe, expect, it } from "vitest";

import { fetchAll, MAX_PAGES, PAGE_SIZE } from "@/lib/supabase/fetch-all";

interface Row {
  id: number;
}

/**
 * A stand-in for PostgREST holding `rows` rows behind a `db-max-rows` ceiling.
 *
 * The ceiling is the whole point: the server clips the window it was asked for and
 * says nothing about having done so, which is why a short page cannot be told apart
 * from the end of the table without asking for one more.
 */
function cappedTable(rows: number, cap = PAGE_SIZE) {
  const all: Row[] = Array.from({ length: rows }, (_, index) => ({ id: index }));
  const asked: Array<[number, number]> = [];

  return {
    /** The windows `fetchAll` requested, in order. */
    asked,
    /** One `.range(from, to)` request. */
    page(from: number, to: number) {
      asked.push([from, to]);
      return Promise.resolve({ data: all.slice(from, to + 1).slice(0, cap), error: null });
    },
    /** A `select()` with no `.range()` — what the admin list pages did. */
    unbounded() {
      return Promise.resolve({ data: all.slice(0, cap), error: null });
    },
  };
}

describe("fetchAll", () => {
  it("reproduces the fault it exists to prevent: an unbounded select is silently short", async () => {
    // 2,273 is the division's live participant count. Under a 1,000-row ceiling a
    // single unbounded read answers with 1,000 rows and `error: null` — nothing a
    // caller can branch on, which is how a page comes to print "1000 listed" as a
    // fact about a roster of 2,273.
    const table = cappedTable(2273);

    const truncated = await table.unbounded();
    expect(truncated.error).toBeNull();
    expect(truncated.data).toHaveLength(PAGE_SIZE);

    // Paged, against the same ceiling, the whole roster comes back.
    expect(await fetchAll<Row>("Participants", table.page)).toHaveLength(2273);
  });

  it("returns every row, in order, with no row read twice", async () => {
    const table = cappedTable(2273);

    const rows = await fetchAll<Row>("Participants", table.page);

    expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 2273 }, (_, i) => i));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(table.asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("asks one page past an exact multiple of the page size", async () => {
    // 2000 rows fill page two exactly. A full page is not evidence of being the last
    // one, so a third request goes out and comes back empty. Stopping on the full
    // page would be right here and wrong for 2001 rows, indistinguishably.
    const table = cappedTable(2 * PAGE_SIZE);

    const rows = await fetchAll<Row>("Entries", table.page);

    expect(rows).toHaveLength(2 * PAGE_SIZE);
    expect(table.asked).toHaveLength(3);
    expect(table.asked.at(-1)).toEqual([2 * PAGE_SIZE, 3 * PAGE_SIZE - 1]);
  });

  it("stops on the short page one row over a multiple", async () => {
    const table = cappedTable(PAGE_SIZE + 1);

    const rows = await fetchAll<Row>("Entries", table.page);

    expect(rows).toHaveLength(PAGE_SIZE + 1);
    expect(table.asked).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ]);
  });

  it("reads an empty table in one request and returns no rows", async () => {
    const table = cappedTable(0);

    expect(await fetchAll<Row>("Coaches", table.page)).toEqual([]);
    expect(table.asked).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it("treats null data with no error as the last page rather than a failure", async () => {
    const rows = await fetchAll<Row>("Coaches", () =>
      Promise.resolve({ data: null, error: null })
    );

    expect(rows).toEqual([]);
  });

  it("raises rather than returning a short answer past MAX_PAGES", async () => {
    // Every page comes back full, so the loop never sees an end. It must refuse to
    // answer at all, not hand back the 60,000 rows it happens to be holding.
    const table = cappedTable(MAX_PAGES * PAGE_SIZE + 1);

    await expect(fetchAll<Row>("Participants", table.page)).rejects.toThrow(
      /Participants runs past 60000 rows/
    );
    expect(table.asked).toHaveLength(MAX_PAGES);
  });

  it("raises on a read error, naming what could not be read and why", async () => {
    await expect(
      fetchAll<Row>("The school registry", () =>
        Promise.resolve({ data: null, error: { message: "permission denied" } })
      )
    ).rejects.toThrow("The school registry could not be read: permission denied");
  });

  it("stops at the failing page instead of grinding through the rest", async () => {
    let calls = 0;

    await expect(
      fetchAll<Row>("Entries", (from) => {
        calls += 1;
        return Promise.resolve(
          from === 0
            ? { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })), error: null }
            : { data: null, error: { message: "connection reset" } }
        );
      })
    ).rejects.toThrow("Entries could not be read: connection reset");

    expect(calls).toBe(2);
  });
});
