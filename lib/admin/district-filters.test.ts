import { describe, expect, it } from "vitest";

import { summarisePerDistrict } from "@/lib/dashboard/per-district";
import type { RegistryRow } from "@/lib/dashboard/school-registry";
import {
  districtEmptyState,
  districtSearchQuery,
  districtTotalsLabel,
  filterDistrictRows,
} from "./district-filters";

/**
 * Rows go through `summarisePerDistrict` rather than being written out as
 * `DistrictRollup` literals, the way `participant-filters.test.ts` goes through
 * `toAdminParticipantRows`. The filter reads `districtName`, which the rollup
 * takes from the `districts` query and not from the school rows — a hand-built
 * rollup could pair a name with counts the fold would never produce, and the test
 * would pass while the page did not.
 */
const districts = [
  { id: "d1", name: "Alabel 1" },
  { id: "d2", name: "Alabel 2" },
  { id: "d3", name: "Malungon 3" },
];

const school = (overrides: Partial<RegistryRow> = {}): RegistryRow => ({
  schoolId: "s1",
  schoolName: "Bagumbayan ES",
  schoolIdNumber: "",
  districtId: "d1",
  districtName: "",
  isIntegrated: false,
  learners: 10,
  coaches: 2,
  entries: 3,
  // Not read by summarisePerDistrict; RegistryRow requires them, so the fixture
  // supplies them rather than casting the shape and hiding the day the rollup
  // starts caring.
  individualLearners: 4,
  individualCoaches: 1,
  groupLearners: 6,
  groupCoaches: 1,
  lockedAt: null,
  ...overrides,
});

const summary = summarisePerDistrict(districts, [
  school(),
  school({ schoolId: "s2", districtId: "d2", learners: 5, coaches: 1, entries: 0 }),
  school({ schoolId: "s3", districtId: "d3", learners: 7, coaches: 3, entries: 4 }),
]);

const names = (rows: { districtName: string }[]) => rows.map((row) => row.districtName);

describe("districtSearchQuery", () => {
  it("is null when the param is absent, empty or all spaces", () => {
    expect(districtSearchQuery({})).toBeNull();
    expect(districtSearchQuery({ q: "" })).toBeNull();
    expect(districtSearchQuery({ q: "   " })).toBeNull();
  });

  it("trims what it returns, so the message quotes the tidy form", () => {
    expect(districtSearchQuery({ q: "  alabel " })).toBe("alabel");
  });

  it("takes the first of a repeated param, as the search box does", () => {
    // `?q=alabel&q=malungon` arrives as an array. `useSearchParams().get` returns
    // the first, so the table has to agree with the box about which is showing.
    expect(districtSearchQuery({ q: ["alabel", "malungon"] })).toBe("alabel");
  });

  it("survives an empty repeated param rather than throwing", () => {
    // `?q=` twice. Reaching `.trim()` on the array would be a 500 off a URL
    // anyone can hand-edit.
    expect(districtSearchQuery({ q: [] })).toBeNull();
  });
});

describe("filterDistrictRows", () => {
  it("returns every row when nothing is set", () => {
    expect(names(filterDistrictRows(summary.rows, {}))).toEqual([
      "Alabel 1",
      "Alabel 2",
      "Malungon 3",
    ]);
  });

  it("keeps the districts query order rather than re-sorting", () => {
    // The page prints these in name order because `summarisePerDistrict` does;
    // filtering must not become a second ordering of the same rows.
    expect(names(filterDistrictRows(summary.rows, { q: "a" }))).toEqual([
      "Alabel 1",
      "Alabel 2",
      "Malungon 3",
    ]);
  });

  it("matches part of a name, case- and whitespace-insensitively", () => {
    expect(names(filterDistrictRows(summary.rows, { q: " ALABEL " }))).toEqual([
      "Alabel 1",
      "Alabel 2",
    ]);
  });

  it("matches the number a name carries, since the cell prints it", () => {
    expect(names(filterDistrictRows(summary.rows, { q: "Alabel 2" }))).toEqual([
      "Alabel 2",
    ]);
  });

  it("does not match the count columns", () => {
    // Alabel 1 has 10 learners. Searching numbers would return an arbitrary
    // handful of rows instead of narrowing to a district anyone was looking for.
    expect(filterDistrictRows(summary.rows, { q: "10" })).toEqual([]);
  });

  it("returns nothing for a query no district matches", () => {
    // The one filter on this page whose empty answer is the true answer.
    expect(filterDistrictRows(summary.rows, { q: "qwerty" })).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(filterDistrictRows(summary.rows, { q: "   " })).toHaveLength(3);
  });

  it("does not fold diacritics, matching every other list in the app", () => {
    const accented = summarisePerDistrict([{ id: "d4", name: "Peña" }], []);
    expect(filterDistrictRows(accented.rows, { q: "pena" })).toEqual([]);
    expect(names(filterDistrictRows(accented.rows, { q: "peña" }))).toEqual(["Peña"]);
  });

  it("returns nothing from an empty roll without throwing", () => {
    expect(filterDistrictRows([], { q: "alabel" })).toEqual([]);
  });
});

describe("districtEmptyState", () => {
  it("blames the roll, not the reader, when nothing is typed", () => {
    expect(districtEmptyState({})).toEqual({
      message: "No districts are on the division roll.",
      narrowed: false,
    });
  });

  it("quotes the query back and offers a way out", () => {
    expect(districtEmptyState({ q: "qwerty" })).toEqual({
      message: "No district matches “qwerty”.",
      narrowed: true,
    });
  });

  it("quotes the trimmed query, matching what the URL carries", () => {
    expect(districtEmptyState({ q: "  qwerty  " }).message).toBe(
      "No district matches “qwerty”."
    );
  });

  it("is narrowed off the control, not off the row count", () => {
    // A query matching all 23 districts still owes the reader the way back, which
    // is why `narrowed` never sees the rows.
    expect(districtEmptyState({ q: "a" }).narrowed).toBe(true);
  });
});

describe("districtTotalsLabel", () => {
  it("is the bare word when nothing is typed", () => {
    expect(districtTotalsLabel({}, 23)).toBe("Division");
  });

  it("names the scope while the table is narrowed", () => {
    // Otherwise four rows sit above a total five times larger, and a footer reads
    // as a sum of the column above it.
    expect(districtTotalsLabel({ q: "alabel" }, 23)).toBe("Division (all 23 districts)");
  });

  it("counts the whole roll, not the rows shown", () => {
    expect(districtTotalsLabel({ q: "alabel" }, 3)).toBe("Division (all 3 districts)");
  });

  it("says district in the singular", () => {
    expect(districtTotalsLabel({ q: "alabel" }, 1)).toBe("Division (all 1 district)");
  });

  it("ignores a blank query, as the filter does", () => {
    expect(districtTotalsLabel({ q: "   " }, 23)).toBe("Division");
  });
});
