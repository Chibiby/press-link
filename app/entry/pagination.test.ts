import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  GAP,
  clampPage,
  pageCount,
  pageSlice,
  pageSlots,
  rangeLabel,
} from "./pagination";

/** The fixture the contest actually runs at: fifty participants, ten a page. */
const ROSTER = Array.from({ length: 50 }, (_, i) => `p${i + 1}`);

describe("pageCount", () => {
  it("gives an empty list a page to be on", () => {
    expect(pageCount(0, 10)).toBe(1);
  });

  it("counts the part-full last page", () => {
    expect(pageCount(50, 10)).toBe(5);
    expect(pageCount(51, 10)).toBe(6);
    expect(pageCount(9, 10)).toBe(1);
  });
});

describe("clampPage", () => {
  it("keeps a page inside the list", () => {
    expect(clampPage(1, 50, 10)).toBe(1);
    expect(clampPage(5, 50, 10)).toBe(5);
  });

  it("lands on the last page when the list has shrunk under it", () => {
    // A school on page 5 searches for one surname: three rows, one page.
    expect(clampPage(5, 3, 10)).toBe(1);
    // The last row on the last page is removed.
    expect(clampPage(5, 41, 10)).toBe(5);
    expect(clampPage(5, 40, 10)).toBe(4);
  });

  it("refuses a page below the first", () => {
    expect(clampPage(0, 50, 10)).toBe(1);
    expect(clampPage(-3, 50, 10)).toBe(1);
    expect(clampPage(Number.NaN, 50, 10)).toBe(1);
  });
});

describe("pageSlice", () => {
  it("cuts the page a school asked for", () => {
    expect(pageSlice(ROSTER, 1, DEFAULT_PAGE_SIZE)).toEqual(ROSTER.slice(0, 10));
    expect(pageSlice(ROSTER, 3, DEFAULT_PAGE_SIZE)).toEqual(ROSTER.slice(20, 30));
  });

  it("stops at the end rather than padding", () => {
    expect(pageSlice(ROSTER, 5, 25)).toEqual(ROSTER.slice(25));
    expect(pageSlice(ROSTER.slice(0, 12), 2, 10)).toHaveLength(2);
  });

  it("shows rows instead of nothing when the page is past the end", () => {
    expect(pageSlice(ROSTER.slice(0, 3), 5, 10)).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps every row when a size makes no sense", () => {
    expect(pageSlice(ROSTER, 1, 0)).toEqual(ROSTER);
  });
});

describe("rangeLabel", () => {
  it("names the rows on screen and the whole list", () => {
    expect(rangeLabel(1, 50, 10)).toBe("1–10 of 50");
    expect(rangeLabel(3, 50, 10)).toBe("21–30 of 50");
  });

  it("does not overrun a part-full last page", () => {
    expect(rangeLabel(5, 42, 10)).toBe("41–42 of 42");
  });

  it("says so when there is nothing", () => {
    expect(rangeLabel(1, 0, 10)).toBe("Nothing to show");
  });
});

describe("pageSlots", () => {
  it("numbers every page of the real roster without a gap", () => {
    expect(pageSlots(1, pageCount(ROSTER.length, DEFAULT_PAGE_SIZE))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("keeps the first and last page in reach from anywhere", () => {
    for (const page of [1, 4, 7, 10]) {
      const slots = pageSlots(page, 10);
      expect(slots[0]).toBe(1);
      expect(slots.at(-1)).toBe(10);
      expect(slots).toContain(page);
    }
  });

  it("spends the middle slots on wherever the school is", () => {
    expect(pageSlots(1, 10)).toEqual([1, 2, 3, GAP, 10]);
    expect(pageSlots(3, 10)).toEqual([1, 2, 3, GAP, 10]);
    expect(pageSlots(4, 10)).toEqual([1, GAP, 4, GAP, 10]);
    expect(pageSlots(8, 10)).toEqual([1, GAP, 8, 9, 10]);
    expect(pageSlots(10, 10)).toEqual([1, GAP, 8, 9, 10]);
  });

  it("never draws more than a 320px row can hold", () => {
    for (let count = 1; count <= 40; count += 1) {
      for (let page = 1; page <= count; page += 1) {
        expect(pageSlots(page, count).length).toBeLessThanOrEqual(5);
      }
    }
  });

  it("puts a gap only where numbers were left out", () => {
    for (let count = 1; count <= 40; count += 1) {
      for (let page = 1; page <= count; page += 1) {
        const slots = pageSlots(page, count);
        const numbers = slots.filter((slot): slot is number => slot !== GAP);
        // Ascending, no repeats, and a gap sits exactly where the run breaks.
        numbers.forEach((n, i) => {
          if (i === 0) return;
          const contiguous = n === numbers[i - 1] + 1;
          const gapped = slots[slots.indexOf(n) - 1] === GAP;
          expect(contiguous || gapped).toBe(true);
        });
      }
    }
  });
});
