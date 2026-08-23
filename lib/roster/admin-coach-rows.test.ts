import { describe, expect, it } from "vitest";

import { filterCoachRows, toAdminCoachRows, type RawAdminCoach } from "./admin-coach-rows";

type RawEntry = NonNullable<RawAdminCoach["entry_coaches"][number]["entries"]>;

const entry = (overrides: Partial<RawEntry> = {}): RawEntry => ({
  id: "e1",
  event_id: "ev1",
  events: {
    category: "individual" as const,
    level: "elementary" as const,
    language: "english" as const,
  },
  ...overrides,
});

const raw = (overrides: Partial<RawAdminCoach> = {}): RawAdminCoach => ({
  id: "c1",
  first_name: "Mario",
  middle_name: null,
  last_name: "Reyes",
  gender: "M",
  schools: {
    id: "s1",
    name: "Bagumbayan ES",
    district_id: "d1",
    districts: { name: "District I" },
  },
  entry_coaches: [{ entries: entry() }],
  ...overrides,
});

describe("toAdminCoachRows", () => {
  it("carries the school and district across", () => {
    const [row] = toAdminCoachRows([raw()]);
    expect(row.fullName).toBe("Reyes, Mario");
    expect(row.schoolName).toBe("Bagumbayan ES");
    expect(row.districtName).toBe("District I");
    expect(row.entryCount).toBe(1);
    expect(row.isMultiEntry).toBe(false);
  });

  it("asterisks a coach on more than one entry", () => {
    const [row] = toAdminCoachRows([
      raw({
        entry_coaches: [{ entries: entry() }, { entries: entry({ id: "e2" }) }],
      }),
    ]);
    expect(row.isMultiEntry).toBe(true);
    expect(row.displayName).toBe("*Reyes, Mario");
    expect(row.entryCount).toBe(2);
  });

  it("counts one entry once, however many contestants the coach takes", () => {
    // An individual entry pairs a coach with each contestant, so a coach who
    // takes all three is three link rows naming one entry. Counting the rows
    // would asterisk them as working several contests.
    const [row] = toAdminCoachRows([
      raw({
        entry_coaches: [{ entries: entry() }, { entries: entry() }, { entries: entry() }],
      }),
    ]);
    expect(row.entryCount).toBe(1);
    expect(row.isMultiEntry).toBe(false);
    expect(row.displayName).toBe("Reyes, Mario");
    expect(row.eventIds).toEqual(["ev1"]);
  });

  it("keeps a coach on no entry at zero", () => {
    const [row] = toAdminCoachRows([raw({ entry_coaches: [] })]);
    expect(row.entryCount).toBe(0);
    expect(row.isMultiEntry).toBe(false);
    expect(row.displayName).toBe("Reyes, Mario");
  });

  it("survives a coach whose school row is missing", () => {
    const [row] = toAdminCoachRows([raw({ schools: null })]);
    expect(row.schoolName).toBe("");
    expect(row.districtName).toBe("");
    expect(row.schoolId).toBe("");
  });

  it("collects the event dimensions the coach is attached to", () => {
    const [row] = toAdminCoachRows([
      raw({
        entry_coaches: [
          { entries: entry() },
          {
            entries: entry({
              id: "e2",
              event_id: "ev2",
              events: { category: "group", level: "secondary", language: "filipino" },
            }),
          },
        ],
      }),
    ]);
    expect(row.eventIds).toEqual(["ev1", "ev2"]);
    expect(row.categories).toEqual(["individual", "group"]);
    expect(row.levels).toEqual(["elementary", "secondary"]);
    expect(row.languages).toEqual(["english", "filipino"]);
  });

  it("sorts by name", () => {
    const rows = toAdminCoachRows([
      raw({ id: "b", last_name: "Zamora" }),
      raw({ id: "a", last_name: "Aquino" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("derives the surname-first name from the parts", () => {
    const [row] = toAdminCoachRows([
      raw({ first_name: "Ana", middle_name: "Mercado", last_name: "Dela Cruz" }),
    ]);
    expect(row.fullName).toBe("Dela Cruz, Ana Mercado");
  });
});

describe("filterCoachRows", () => {
  const rows = toAdminCoachRows([
    raw({ id: "solo", last_name: "A", gender: "M" }),
    raw({
      id: "multi",
      last_name: "B",
      gender: "F",
      entry_coaches: [
        { entries: entry() },
        {
          entries: entry({
            id: "e2",
            event_id: "ev2",
            events: { category: "group", level: "secondary", language: "filipino" },
          }),
        },
      ],
    }),
    raw({ id: "idle", last_name: "C", gender: "F", entry_coaches: [] }),
    raw({
      id: "other",
      last_name: "D",
      schools: { id: "s2", name: "Zamora ES", district_id: "d2", districts: { name: "District II" } },
    }),
  ]);

  it("returns everything when nothing is filtered", () => {
    expect(filterCoachRows(rows, {})).toHaveLength(4);
  });

  it("filters by district, school and gender", () => {
    expect(filterCoachRows(rows, { district: "d2" }).map((r) => r.id)).toEqual(["other"]);
    expect(filterCoachRows(rows, { school: "s2" }).map((r) => r.id)).toEqual(["other"]);
    expect(filterCoachRows(rows, { gender: "F" }).map((r) => r.id)).toEqual(["multi", "idle"]);
  });

  it("filters to multi-entry coaches only", () => {
    expect(filterCoachRows(rows, { multi: "1" }).map((r) => r.id)).toEqual(["multi"]);
  });

  it("filters to unassigned coaches only", () => {
    expect(filterCoachRows(rows, { unassigned: "1" }).map((r) => r.id)).toEqual(["idle"]);
  });

  it("filters by the event dimensions of the entries a coach is on", () => {
    expect(filterCoachRows(rows, { event: "ev2" }).map((r) => r.id)).toEqual(["multi"]);
    expect(filterCoachRows(rows, { category: "group" }).map((r) => r.id)).toEqual(["multi"]);
    expect(filterCoachRows(rows, { level: "secondary" }).map((r) => r.id)).toEqual(["multi"]);
    expect(filterCoachRows(rows, { language: "filipino" }).map((r) => r.id)).toEqual(["multi"]);
  });

  it("excludes an unassigned coach from every event-dimension filter", () => {
    expect(filterCoachRows(rows, { language: "english" }).map((r) => r.id)).not.toContain("idle");
  });

  it("ands multiple filters together", () => {
    expect(filterCoachRows(rows, { gender: "F", multi: "1" }).map((r) => r.id)).toEqual(["multi"]);
  });

  it("ignores an unrecognised filter value rather than emptying the table", () => {
    expect(filterCoachRows(rows, { gender: "X" })).toHaveLength(4);
    expect(filterCoachRows(rows, { category: "nonsense" })).toHaveLength(4);
  });
});
