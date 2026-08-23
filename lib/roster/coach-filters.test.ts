import { describe, expect, it } from "vitest";

import { toAdminCoachRows, type RawAdminCoach } from "./admin-coach-rows";
import {
  coachEmptyState,
  coachSearchQuery,
  filterCoachListRows,
} from "./coach-filters";

/**
 * Rows go through the real mapper rather than being written out as `AdminCoachRow`
 * literals, the way `admin-coach-rows.test.ts` and `participant-filters.test.ts` do
 * it. The filter searches `displayName`, which the mapper derives — a hand-built row
 * could hold an asterisk the mapper would never produce, and the test would pass
 * while the page did not.
 */
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

const rows = toAdminCoachRows([
  // Sorted by name in the mapper, so this is "Dela Cruz, Ana", "Reyes, Mario",
  // "Santos, Jose".
  raw({
    id: "c2",
    first_name: "Ana",
    last_name: "Dela Cruz",
    gender: "F",
    // Two entries, so the mapper asterisks the name.
    entry_coaches: [{ entries: entry() }, { entries: entry({ id: "e2" }) }],
  }),
  raw(),
  raw({
    id: "c3",
    first_name: "Jose",
    last_name: "Santos",
    schools: {
      id: "s2",
      name: "Zamora ES",
      district_id: "d2",
      districts: { name: "District II" },
    },
    entry_coaches: [],
  }),
]);

const ids = (filtered: { id: string }[]) => filtered.map((row) => row.id);
const ALL = ["c2", "c1", "c3"];

describe("coachSearchQuery", () => {
  it("is null when the param is absent, empty or all spaces", () => {
    expect(coachSearchQuery({})).toBeNull();
    expect(coachSearchQuery({ q: "" })).toBeNull();
    expect(coachSearchQuery({ q: "   " })).toBeNull();
  });

  it("trims what it returns, so the message quotes the tidy form", () => {
    expect(coachSearchQuery({ q: "  reyes " })).toBe("reyes");
  });

  it("takes the first of a repeated param, as the filter bar's box does", () => {
    // `?q=reyes&q=santos` arrives as an array. `useSearchParams().get` returns the
    // first, so the table has to agree with the box about which one is showing.
    expect(coachSearchQuery({ q: ["reyes", "santos"] })).toBe("reyes");
  });

  it("survives an empty repeated param rather than throwing", () => {
    expect(coachSearchQuery({ q: [] })).toBeNull();
  });
});

describe("filterCoachListRows", () => {
  it("returns every row when nothing is set", () => {
    expect(ids(filterCoachListRows(rows, {}))).toEqual(ALL);
  });

  it("matches a name, case- and whitespace-insensitively", () => {
    expect(ids(filterCoachListRows(rows, { q: " REYES " }))).toEqual(["c1"]);
  });

  it("matches the school, so one school's coaches can be listed by typing it", () => {
    expect(ids(filterCoachListRows(rows, { q: "zamora" }))).toEqual(["c3"]);
  });

  it("matches the name with or without the multi-entry asterisk", () => {
    // The cell prints "*Dela Cruz, Ana", so a pasted copy of it has to find the
    // same coach as the name typed plainly.
    expect(ids(filterCoachListRows(rows, { q: "dela cruz" }))).toEqual(["c2"]);
    expect(ids(filterCoachListRows(rows, { q: "*dela cruz" }))).toEqual(["c2"]);
  });

  it("does not search the district or the gender, which have their own dropdowns", () => {
    expect(filterCoachListRows(rows, { q: "District II" })).toEqual([]);
    expect(filterCoachListRows(rows, { q: "F" })).toEqual([]);
  });

  it("returns nothing for a query no row matches", () => {
    // The one filter here whose empty answer is the true answer.
    expect(filterCoachListRows(rows, { q: "qwerty" })).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(ids(filterCoachListRows(rows, { q: "  " }))).toEqual(ALL);
  });

  it("applies the search on top of the dropdowns, not instead of them", () => {
    expect(ids(filterCoachListRows(rows, { q: "a", district: "d1" }))).toEqual([
      "c2",
      "c1",
    ]);
    expect(ids(filterCoachListRows(rows, { q: "reyes", district: "d2" }))).toEqual([]);
  });

  it("keeps the dropdown and toggle filters the page already had", () => {
    expect(ids(filterCoachListRows(rows, { district: "d2" }))).toEqual(["c3"]);
    expect(ids(filterCoachListRows(rows, { school: "s1" }))).toEqual(["c2", "c1"]);
    expect(ids(filterCoachListRows(rows, { gender: "F" }))).toEqual(["c2"]);
    expect(ids(filterCoachListRows(rows, { multi: "1" }))).toEqual(["c2"]);
    expect(ids(filterCoachListRows(rows, { unassigned: "1" }))).toEqual(["c3"]);
    expect(ids(filterCoachListRows(rows, { event: "ev1" }))).toEqual(["c2", "c1"]);
    expect(ids(filterCoachListRows(rows, { language: "english" }))).toEqual([
      "c2",
      "c1",
    ]);
  });

  it("leaves the incoming order alone", () => {
    // The mapper sorts by name; filtering must not reshuffle what survives.
    expect(ids(filterCoachListRows(rows, { q: "bagumbayan" }))).toEqual(["c2", "c1"]);
  });
});

describe("coachEmptyState", () => {
  it("says the roster is empty only when no control is set", () => {
    expect(coachEmptyState({})).toEqual({
      message: "No coaches are registered yet.",
      narrowed: false,
    });
  });

  it("quotes the query back, so a typo is visible", () => {
    const state = coachEmptyState({ q: " qwerty " });
    expect(state.message).toBe("No coaches match “qwerty”.");
    expect(state.narrowed).toBe(true);
  });

  it("names both causes when a query and a filter are set", () => {
    const state = coachEmptyState({ q: "reyes", district: "d2" });
    expect(state.message).toBe("No coaches match “reyes” with these filters.");
    expect(state.narrowed).toBe(true);
  });

  it("keeps the filters-only wording the page already used", () => {
    expect(coachEmptyState({ school: "s1" })).toEqual({
      message: "No coaches match these filters.",
      narrowed: true,
    });
  });

  it("counts every control the bar can set as narrowing", () => {
    // The list the Clear button counts. One missing here is a reader on a filtered
    // table being told the roster is empty.
    for (const filters of [
      { district: "d1" },
      { school: "s1" },
      { gender: "F" },
      { multi: "1" },
      { unassigned: "1" },
      { event: "ev1" },
      { category: "group" },
      { level: "secondary" },
      { language: "filipino" },
    ]) {
      expect(coachEmptyState(filters).narrowed).toBe(true);
    }
  });

  it("is not narrowed by a blank query", () => {
    // Otherwise the table would offer a way back from a filter that is not on.
    expect(coachEmptyState({ q: "   " }).narrowed).toBe(false);
  });

  it("agrees with the row filter about which values are no filter at all", () => {
    // `filterCoachRows` treats an unrecognised URL value as no filter rather than as
    // a filter nothing matches, so a hand-edited URL cannot present an empty table as
    // if the division had no coaches. The empty state has to read those same values
    // the same way, or `?gender=X` would show every row *and* offer a way back from a
    // filter that is off.
    for (const filters of [
      { gender: "X" },
      { multi: "yes" },
      { unassigned: "0" },
      { category: "pair" },
      { level: "college" },
      { language: "spanish" },
    ]) {
      expect(ids(filterCoachListRows(rows, filters))).toEqual(ALL);
      expect(coachEmptyState(filters).narrowed).toBe(false);
    }
  });
});
