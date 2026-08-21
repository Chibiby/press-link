import { describe, expect, it } from "vitest";

import { summarisePerSchool, type SchoolRollupRow } from "./per-school";

function row(
  schoolName: string,
  entries: number,
  learners: number,
  coaches = 1
): SchoolRollupRow {
  return {
    schoolId: schoolName.toLowerCase().replace(/\s+/g, "-"),
    schoolName,
    districtId: "district-1",
    districtName: "District I",
    learners,
    coaches,
    entries,
  };
}

describe("summarisePerSchool", () => {
  it("ranks by entries descending", () => {
    const summary = summarisePerSchool(
      [row("Bravo NHS", 4, 10), row("Alfa NHS", 9, 20), row("Charlie NHS", 6, 15)],
      { limit: 15, registeredSchools: 332 }
    );
    expect(summary.rows.map((r) => r.schoolName)).toEqual([
      "Alfa NHS",
      "Charlie NHS",
      "Bravo NHS",
    ]);
  });

  it("breaks ties on learners, then on name", () => {
    const summary = summarisePerSchool(
      [row("Zulu NHS", 3, 5), row("Alfa NHS", 3, 5), row("Mike NHS", 3, 9)],
      { limit: 15, registeredSchools: 332 }
    );
    expect(summary.rows.map((r) => r.schoolName)).toEqual([
      "Mike NHS",
      "Alfa NHS",
      "Zulu NHS",
    ]);
  });

  it("truncates to the limit and says how many it hid", () => {
    const active = Array.from({ length: 22 }, (_, i) =>
      row(`School ${String(i).padStart(2, "0")}`, 22 - i, 1)
    );
    const summary = summarisePerSchool(active, { limit: 15, registeredSchools: 332 });
    expect(summary.rows).toHaveLength(15);
    expect(summary.hiddenSchools).toBe(7);
    expect(summary.activeSchools).toBe(22);
    expect(summary.registeredSchools).toBe(332);
  });

  it("totals every active school, not just the visible ones", () => {
    const active = Array.from({ length: 22 }, () => row("School", 2, 3, 1));
    const summary = summarisePerSchool(active, { limit: 15, registeredSchools: 332 });
    expect(summary.totals).toEqual({ learners: 66, coaches: 22, entries: 44 });
  });

  it("hides nothing when the active set fits", () => {
    const summary = summarisePerSchool([row("Alfa NHS", 1, 1)], {
      limit: 15,
      registeredSchools: 332,
    });
    expect(summary.rows).toHaveLength(1);
    expect(summary.hiddenSchools).toBe(0);
  });

  it("handles a division with no activity at all", () => {
    const summary = summarisePerSchool([], { limit: 15, registeredSchools: 332 });
    expect(summary.rows).toEqual([]);
    expect(summary.totals).toEqual({ learners: 0, coaches: 0, entries: 0 });
    expect(summary.activeSchools).toBe(0);
    expect(summary.hiddenSchools).toBe(0);
    expect(summary.registeredSchools).toBe(332);
  });

  it("does not reorder the caller's array", () => {
    const active = [row("Bravo NHS", 1, 1), row("Alfa NHS", 9, 1)];
    summarisePerSchool(active, { limit: 15, registeredSchools: 332 });
    expect(active.map((r) => r.schoolName)).toEqual(["Bravo NHS", "Alfa NHS"]);
  });
});
