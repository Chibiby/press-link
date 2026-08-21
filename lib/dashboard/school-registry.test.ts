import { describe, expect, it } from "vitest";

import { isSchoolStatus, summariseRegistry, type RegistryRow } from "./school-registry";

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return {
    schoolId: "s1",
    schoolName: "Alabel National High School",
    schoolIdNumber: "300001",
    districtId: "d1",
    districtName: "Alabel",
    learners: 12,
    coaches: 3,
    entries: 9,
    lockedAt: null,
    ...over,
  };
}

const ALL = [
  row({ schoolId: "entered", learners: 12, coaches: 3, entries: 9 }),
  row({ schoolId: "roster-only", learners: 8, coaches: 2, entries: 0 }),
  row({ schoolId: "coach-only", learners: 0, coaches: 1, entries: 0 }),
  row({ schoolId: "silent", learners: 0, coaches: 0, entries: 0 }),
  row({ schoolId: "locked", entries: 4, lockedAt: "2026-08-10T02:00:00+00:00" }),
];

describe("summariseRegistry", () => {
  it("shows every school when nothing is filtered", () => {
    const summary = summariseRegistry(ALL, { status: "all", districtId: null });
    expect(summary.shown).toBe(5);
    expect(summary.registered).toBe(5);
  });

  it("selects learners-no-entry with the same predicate the attention count uses", () => {
    // schoolsWithLearnersButNoEntry is `learners > 0 && entries === 0`. "coach-only" has
    // no learners, so it is NOT in this set — and if this test ever goes green with it
    // included, the dashboard row will link to a longer list than its own badge claims.
    const summary = summariseRegistry(ALL, {
      status: "learners-no-entry",
      districtId: null,
    });
    expect(summary.rows.map((r) => r.schoolId)).toEqual(["roster-only"]);
  });

  it("selects no-data as nothing at all on record", () => {
    const summary = summariseRegistry(ALL, { status: "no-data", districtId: null });
    expect(summary.rows.map((r) => r.schoolId)).toEqual(["silent"]);
  });

  it("totals the rows it shows, not the rows it hides", () => {
    const summary = summariseRegistry(ALL, { status: "entered", districtId: null });
    expect(summary.rows.map((r) => r.schoolId)).toEqual(["entered", "locked"]);
    expect(summary.totals).toEqual({ learners: 24, coaches: 6, entries: 13 });
  });

  it("keeps registered as the district's total, so the footer reads N of M", () => {
    const mixed = [
      row({ schoolId: "a", districtId: "d1", entries: 2 }),
      row({ schoolId: "b", districtId: "d1", learners: 5, entries: 0 }),
      row({ schoolId: "c", districtId: "d2", entries: 7 }),
    ];
    const summary = summariseRegistry(mixed, {
      status: "learners-no-entry",
      districtId: "d1",
    });
    expect(summary.shown).toBe(1);
    // Two schools in d1, one of them matching — not 1 of 3, and not 1 of 1.
    expect(summary.registered).toBe(2);
  });

  it("leaves the query's name order alone", () => {
    const rows = [
      row({ schoolId: "z", schoolName: "Zamora" }),
      row({ schoolId: "a", schoolName: "Alabel" }),
    ];
    const summary = summariseRegistry(rows, { status: "all", districtId: null });
    expect(summary.rows.map((r) => r.schoolName)).toEqual(["Zamora", "Alabel"]);
  });
});

describe("isSchoolStatus", () => {
  it("accepts the five real values", () => {
    for (const value of ["all", "learners-no-entry", "no-data", "entered", "locked"]) {
      expect(isSchoolStatus(value)).toBe(true);
    }
  });

  it("rejects junk and undefined, so a bad URL falls back to all", () => {
    expect(isSchoolStatus("locked;drop")).toBe(false);
    expect(isSchoolStatus(undefined)).toBe(false);
  });
});
