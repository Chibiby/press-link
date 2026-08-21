import { describe, expect, it } from "vitest";

import type { PerSchoolSummary } from "@/lib/dashboard/per-school";

import { toOverallDataRows } from "./overall-data-workbook";

const summary = (over: Partial<PerSchoolSummary> = {}): PerSchoolSummary => ({
  rows: [
    {
      schoolId: "a",
      schoolName: "Alabel National High School",
      districtId: "d-alabel",
      districtName: "Alabel",
      learners: 12,
      coaches: 3,
      entries: 9,
    },
    {
      schoolId: "b",
      schoolName: "Malapatan Central",
      districtId: "d-malapatan",
      districtName: "Malapatan",
      learners: 4,
      coaches: 1,
      entries: 2,
    },
  ],
  totals: { learners: 40, coaches: 10, entries: 30 },
  activeSchools: 6,
  registeredSchools: 332,
  hiddenSchools: 4,
  ...over,
});

describe("toOverallDataRows", () => {
  it("keeps one row per school, in the order given", () => {
    const rows = toOverallDataRows(summary());

    expect(rows.slice(0, 2)).toEqual([
      {
        School: "Alabel National High School",
        District: "Alabel",
        Learners: 12,
        Coaches: 3,
        Entries: 9,
      },
      { School: "Malapatan Central", District: "Malapatan", Learners: 4, Coaches: 1, Entries: 2 },
    ]);
  });

  it("ends with the division-wide total, not the sum of the rows above it", () => {
    // The dashboard truncates; the totals never do. A reader who adds up the
    // visible column and gets a different number must be able to see why.
    const rows = toOverallDataRows(summary());

    expect(rows.at(-1)).toEqual({
      School: "DIVISION TOTAL",
      District: "6 of 332 schools",
      Learners: 40,
      Coaches: 10,
      Entries: 30,
    });
  });

  it("still emits the total row when no school has data", () => {
    const rows = toOverallDataRows(
      summary({
        rows: [],
        totals: { learners: 0, coaches: 0, entries: 0 },
        activeSchools: 0,
        hiddenSchools: 0,
      })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].School).toBe("DIVISION TOTAL");
  });

  it("writes an empty district cell rather than the word undefined", () => {
    const rows = toOverallDataRows(
      summary({
        rows: [
          {
            schoolId: "a",
            schoolName: "Unassigned",
            districtId: "",
            districtName: "",
            learners: 0,
            coaches: 0,
            entries: 0,
          },
        ],
      })
    );

    expect(rows[0].District).toBe("");
  });
});
