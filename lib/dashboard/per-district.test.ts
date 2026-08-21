import { describe, expect, it } from "vitest";

import { summarisePerDistrict } from "./per-district";
import type { RegistryRow } from "./school-registry";

function school(over: Partial<RegistryRow> = {}): RegistryRow {
  return {
    schoolId: "s1",
    schoolName: "A School",
    schoolIdNumber: "300001",
    districtId: "d1",
    districtName: "Alabel",
    // Not read by summarisePerDistrict; RegistryRow requires it, so the fixture supplies
    // it rather than casting the shape and hiding the day the rollup starts caring.
    isIntegrated: false,
    learners: 0,
    coaches: 0,
    entries: 0,
    lockedAt: null,
    ...over,
  };
}

const DISTRICTS = [
  { id: "d1", name: "Alabel" },
  { id: "d2", name: "Malapatan" },
  { id: "d3", name: "Maasim" },
];

const SCHOOLS = [
  school({ schoolId: "a", districtId: "d1", learners: 12, coaches: 3, entries: 9 }),
  school({ schoolId: "b", districtId: "d1", learners: 8, coaches: 2, entries: 0 }),
  school({ schoolId: "c", districtId: "d1" }),
  school({ schoolId: "d", districtId: "d2", learners: 4, coaches: 1, entries: 2 }),
];

describe("summarisePerDistrict", () => {
  it("gives a district with no schools a row of zeroes rather than no row", () => {
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.rows).toHaveLength(3);

    const maasim = summary.rows.find((row) => row.districtId === "d3");
    expect(maasim).toEqual({
      districtId: "d3",
      districtName: "Maasim",
      schools: 0,
      schoolsWithData: 0,
      schoolsWithEntries: 0,
      learners: 0,
      coaches: 0,
      entries: 0,
    });
  });

  it("rolls a district's schools up into one row", () => {
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.rows[0]).toEqual({
      districtId: "d1",
      districtName: "Alabel",
      schools: 3,
      // "c" has nothing at all, so it counts as a school and nothing else.
      schoolsWithData: 2,
      schoolsWithEntries: 1,
      learners: 20,
      coaches: 5,
      entries: 9,
    });
  });

  it("counts districts with entries the way the dashboard KPI does", () => {
    // SchoolFacts.districtsWithEntries is the distinct district ids of schools with
    // entries > 0. Two districts here hold an entered school; the third does not.
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.districtsWithEntries).toBe(2);
  });

  it("totals every column across the districts it shows", () => {
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.totals).toEqual({
      schools: 4,
      schoolsWithData: 3,
      schoolsWithEntries: 2,
      learners: 24,
      coaches: 6,
      entries: 11,
    });
  });

  it("keeps the districts list's order, which the query has already sorted by name", () => {
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.rows.map((row) => row.districtName)).toEqual([
      "Alabel",
      "Malapatan",
      "Maasim",
    ]);
  });

  it("ignores a school whose district is not in the list", () => {
    // schools.district_id is `not null references districts(id)`, so this cannot happen
    // in production. The assertion is here so that if it ever does, the page shows a
    // smaller number rather than crashing on an undefined rollup.
    const summary = summarisePerDistrict(DISTRICTS, [
      ...SCHOOLS,
      school({ schoolId: "orphan", districtId: "gone", entries: 99 }),
    ]);
    expect(summary.totals.entries).toBe(11);
  });
});
