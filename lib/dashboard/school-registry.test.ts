import { describe, expect, it } from "vitest";

import { isSchoolStatus, summariseRegistry, type RegistryRow } from "./school-registry";

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return {
    schoolId: "s1",
    schoolName: "Alabel National High School",
    schoolIdNumber: "300001",
    districtId: "d1",
    districtName: "Alabel",
    isIntegrated: false,
    learners: 12,
    coaches: 3,
    entries: 9,
    individualLearners: 5,
    individualCoaches: 2,
    groupLearners: 7,
    groupCoaches: 3,
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

// A roll that mixes both kinds of school at both ends of the progress scale, so a filter
// that quietly conflated "integrated" with "has entries" would show up here.
const MIXED = [
  row({ schoolId: "integrated-entered", isIntegrated: true, learners: 10, entries: 5 }),
  row({ schoolId: "integrated-silent", isIntegrated: true, learners: 0, coaches: 0, entries: 0 }),
  row({ schoolId: "plain-entered", isIntegrated: false, learners: 10, entries: 5 }),
  row({ schoolId: "plain-silent", isIntegrated: false, learners: 0, coaches: 0, entries: 0 }),
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
    // Neither "entered" nor "locked" overrides the category fields, so each
    // fixture row contributes the row() defaults once.
    expect(summary.totals).toEqual({
      individualLearners: 10,
      individualCoaches: 4,
      groupLearners: 14,
      groupCoaches: 6,
    });
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

  it("selects integrated schools from the stored flag, whatever their progress", () => {
    // Both integrated schools, and only those: the entered one and the silent one. If the
    // predicate ever borrowed a progress test, one of the two would drop out here.
    const summary = summariseRegistry(MIXED, { status: "integrated", districtId: null });
    expect(summary.rows.map((r) => r.schoolId)).toEqual([
      "integrated-entered",
      "integrated-silent",
    ]);
  });

  it("shows no integrated schools on a roll that has none", () => {
    // Every ALL fixture defaults to isIntegrated: false, which is also the column's
    // default — an un-seeded database gives an empty table, not the whole roll.
    const summary = summariseRegistry(ALL, { status: "integrated", districtId: null });
    expect(summary.shown).toBe(0);
    expect(summary.registered).toBe(5);
  });

  it("keeps integrated schools inside the other filters, not beside them", () => {
    // "integrated" narrows the view like any other status; it does not carve the
    // integrated schools out of the population the progress filters see.
    const summary = summariseRegistry(MIXED, { status: "no-data", districtId: null });
    expect(summary.rows.map((r) => r.schoolId)).toEqual([
      "integrated-silent",
      "plain-silent",
    ]);
  });

  it("totals the integrated rows it shows", () => {
    const summary = summariseRegistry(MIXED, { status: "integrated", districtId: null });
    expect(summary.shown).toBe(2);
    // Only the two integrated rows, neither of which overrides the category
    // fields: each row() default counted once.
    expect(summary.totals).toEqual({
      individualLearners: 10,
      individualCoaches: 4,
      groupLearners: 14,
      groupCoaches: 6,
    });
  });

  it("narrows integrated by district without moving the denominator", () => {
    const rows = [
      row({ schoolId: "a", districtId: "d1", isIntegrated: true }),
      row({ schoolId: "b", districtId: "d1", isIntegrated: false }),
      row({ schoolId: "c", districtId: "d2", isIntegrated: true }),
    ];
    const summary = summariseRegistry(rows, { status: "integrated", districtId: "d1" });
    expect(summary.rows.map((r) => r.schoolId)).toEqual(["a"]);
    // One of the two schools in d1 — the status must not shrink `registered`.
    expect(summary.registered).toBe(2);
  });
});

describe("isSchoolStatus", () => {
  it("accepts the six real values", () => {
    for (const value of [
      "all",
      "learners-no-entry",
      "no-data",
      "entered",
      "locked",
      "integrated",
    ]) {
      expect(isSchoolStatus(value)).toBe(true);
    }
  });

  it("rejects junk and undefined, so a bad URL falls back to all", () => {
    expect(isSchoolStatus("locked;drop")).toBe(false);
    expect(isSchoolStatus(undefined)).toBe(false);
  });
});
