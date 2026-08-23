import { describe, expect, it } from "vitest";

import {
  schoolRegistryEmptyState,
  schoolRegistrySearchQuery,
  schoolRegistryStatus,
  summariseSchoolRegistry,
  toRegistryRows,
  type RawRegistrySchool,
} from "./school-registry-filters";

/**
 * Rows go through `toRegistryRows`, the mapper the page itself calls, rather than
 * being written out as `RegistryRow` literals: the counts arrive from Supabase as
 * one-element arrays and the filters below run on what the unwrapping produced.
 */
const raw = (over: Partial<RawRegistrySchool> = {}): RawRegistrySchool => ({
  id: "s1",
  name: "Alabel National High School",
  school_id_number: "300001",
  district_id: "d1",
  is_integrated: false,
  submission_locked_at: null,
  districts: { name: "Alabel" },
  participants: [{ count: 12 }],
  coaches: [{ count: 3 }],
  entries: [{ count: 9 }],
  ...over,
});

// In the order the query returns them — by name — because nothing here re-sorts.
const rows = toRegistryRows([
  raw(),
  raw({
    id: "s2",
    name: "Maasim Central ES",
    school_id_number: "300002",
    district_id: "d2",
    districts: { name: "Maasim" },
    // A school with nothing on record: Supabase sends an empty array, not a zero.
    participants: [],
    coaches: [],
    entries: [],
  }),
  raw({
    id: "s3",
    name: "Malandag Integrated School",
    school_id_number: "300003",
    is_integrated: true,
    participants: [{ count: 8 }],
    coaches: [{ count: 2 }],
    entries: [{ count: 0 }],
  }),
]);

const ids = (rowsIn: { schoolId: string }[]) => rowsIn.map((row) => row.schoolId);
const ALL = ["s1", "s2", "s3"];

describe("toRegistryRows", () => {
  it("unwraps the aggregate counts and falls back to zero, not undefined", () => {
    // `[]` has to become `0`, or the footer's totals reduce to NaN and the "Nothing
    // on record" badge stops appearing for the schools it is meant to flag.
    expect(rows[1]).toMatchObject({
      schoolId: "s2",
      schoolIdNumber: "300002",
      learners: 0,
      coaches: 0,
      entries: 0,
    });
    expect(rows[0]).toMatchObject({ learners: 12, coaches: 3, entries: 9 });
  });

  it("carries the district name across, and empties it when the join came back null", () => {
    expect(rows[0].districtName).toBe("Alabel");
    expect(toRegistryRows([raw({ districts: null })])[0].districtName).toBe("");
  });

  it("keeps the query's order", () => {
    expect(ids(rows)).toEqual(ALL);
  });
});

describe("schoolRegistrySearchQuery", () => {
  it("is null when the param is absent, empty or all spaces", () => {
    expect(schoolRegistrySearchQuery({})).toBeNull();
    expect(schoolRegistrySearchQuery({ q: "" })).toBeNull();
    expect(schoolRegistrySearchQuery({ q: "   " })).toBeNull();
  });

  it("trims what it returns, so the message quotes the tidy form", () => {
    expect(schoolRegistrySearchQuery({ q: "  malandag " })).toBe("malandag");
  });

  it("takes the first of a repeated param, as the filter bar's box does", () => {
    // `useSearchParams().get` returns the first, so the table has to agree with the
    // box about which one is showing.
    expect(schoolRegistrySearchQuery({ q: ["malandag", "maasim"] })).toBe("malandag");
  });

  it("survives an empty repeated param rather than throwing", () => {
    expect(schoolRegistrySearchQuery({ q: [] })).toBeNull();
  });
});

describe("schoolRegistryStatus", () => {
  it("falls back to all for an absent or junk value", () => {
    expect(schoolRegistryStatus({})).toBe("all");
    expect(schoolRegistryStatus({ status: "nonsense" })).toBe("all");
  });

  it("passes a recognised status through", () => {
    expect(schoolRegistryStatus({ status: "locked" })).toBe("locked");
  });
});

describe("summariseSchoolRegistry", () => {
  it("shows the whole roll when nothing is set", () => {
    const summary = summariseSchoolRegistry(rows, {});
    expect(ids(summary.rows)).toEqual(ALL);
    expect(summary.shown).toBe(3);
    expect(summary.registered).toBe(3);
    expect(summary.totals).toEqual({ learners: 20, coaches: 5, entries: 9 });
  });

  it("matches the school name, case- and whitespace-insensitively", () => {
    expect(ids(summariseSchoolRegistry(rows, { q: " MALANDAG " }).rows)).toEqual(["s3"]);
  });

  it("matches the id number printed under the name", () => {
    // The officer's copy of the form has the number on it, so the number has to find
    // its own row.
    expect(ids(summariseSchoolRegistry(rows, { q: "300002" }).rows)).toEqual(["s2"]);
  });

  it("does not search the district, which has its own dropdown", () => {
    // "Alabel" is the district of both s1 and s3, and the name of only s1. If the
    // district were in the haystack this would return two rows and duplicate a
    // control that might be showing "All districts" at the same time.
    expect(ids(summariseSchoolRegistry(rows, { q: "alabel" }).rows)).toEqual(["s1"]);
  });

  it("returns nothing for a query no school matches", () => {
    // The one filter here whose empty answer is the true answer.
    expect(summariseSchoolRegistry(rows, { q: "qwerty" }).rows).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(ids(summariseSchoolRegistry(rows, { q: "   " }).rows)).toEqual(ALL);
  });

  it("keeps the district and status filters the page already had", () => {
    expect(ids(summariseSchoolRegistry(rows, { district: "d2" }).rows)).toEqual(["s2"]);
    expect(ids(summariseSchoolRegistry(rows, { status: "no-data" }).rows)).toEqual([
      "s2",
    ]);
    expect(
      ids(summariseSchoolRegistry(rows, { status: "learners-no-entry" }).rows)
    ).toEqual(["s3"]);
  });

  it("shows the whole roll for a junk status rather than an empty table", () => {
    expect(ids(summariseSchoolRegistry(rows, { status: "nonsense" }).rows)).toEqual(ALL);
  });

  it("applies the search on top of the dropdowns, not instead of them", () => {
    expect(
      ids(summariseSchoolRegistry(rows, { q: "school", status: "learners-no-entry" }).rows)
    ).toEqual(["s3"]);
    expect(summariseSchoolRegistry(rows, { q: "maasim", district: "d1" }).rows).toEqual(
      []
    );
  });

  it("leaves the district's denominator alone while the search box narrows the view", () => {
    // The subtitle reads "{shown} of {registered} schools in Alabel". District moves
    // the population; a typed query must not, or the sentence always says "1 of 1"
    // and stops being a comparison.
    const searched = summariseSchoolRegistry(rows, { q: "malandag", district: "d1" });
    expect(searched.shown).toBe(1);
    expect(searched.registered).toBe(2);

    const district = summariseSchoolRegistry(rows, { district: "d1" });
    expect(district.shown).toBe(2);
    expect(district.registered).toBe(2);

    // Status is a view filter too, and always was.
    expect(summariseSchoolRegistry(rows, { status: "no-data" }).registered).toBe(3);
  });

  it("sums the columns over the rows on screen and no others", () => {
    // The footer prints these totals directly under the rows, so a sum taken before
    // the search ran would contradict what is above it.
    expect(summariseSchoolRegistry(rows, { q: "malandag" }).totals).toEqual({
      learners: 8,
      coaches: 2,
      entries: 0,
    });
  });

  it("leaves the incoming order alone", () => {
    expect(ids(summariseSchoolRegistry(rows, { q: "a" }).rows)).toEqual(ALL);
  });
});

describe("schoolRegistryEmptyState", () => {
  it("says the roll is empty only when no control is set", () => {
    expect(schoolRegistryEmptyState({})).toEqual({
      message: "No schools are on the division roll yet.",
      narrowed: false,
    });
  });

  it("quotes the query back, so a typo is visible", () => {
    const state = schoolRegistryEmptyState({ q: " qwerty " });
    expect(state.message).toBe("No schools match “qwerty”.");
    expect(state.narrowed).toBe(true);
  });

  it("names both causes when a query and a filter are set", () => {
    const state = schoolRegistryEmptyState({ q: "malandag", status: "locked" });
    expect(state.message).toBe("No schools match “malandag” with these filters.");
    expect(state.narrowed).toBe(true);
  });

  it("offers a way back from either dropdown on its own", () => {
    expect(schoolRegistryEmptyState({ district: "d1" })).toEqual({
      message: "No schools match these filters.",
      narrowed: true,
    });
    expect(schoolRegistryEmptyState({ status: "locked" }).narrowed).toBe(true);
  });

  it("is not narrowed by a blank query, the all status, or a junk one", () => {
    // "all" is the dropdown's placeholder rather than a selection, and a junk value
    // has already fallen back to it — so neither is narrowing anything, and the table
    // must not offer a way back from a filter that is off.
    expect(schoolRegistryEmptyState({ q: "   " }).narrowed).toBe(false);
    expect(schoolRegistryEmptyState({ status: "all" }).narrowed).toBe(false);
    expect(schoolRegistryEmptyState({ status: "nonsense" }).narrowed).toBe(false);
  });
});
