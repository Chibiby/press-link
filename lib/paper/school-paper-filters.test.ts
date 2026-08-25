import { describe, expect, it } from "vitest";

import {
  toAdminSchoolPaperRows,
  type RawAdminSchoolPaper,
  type RawAdminSchoolPaperFile,
} from "./admin-papers";
import {
  eligibleSchoolPaperRows,
  filterSchoolPaperListRows,
  schoolPaperEmptyState,
  schoolPaperSearchQuery,
} from "./school-paper-filters";

/**
 * Rows go through the real mapper rather than being written out as
 * `AdminSchoolPaperRow` literals, the way `admin-papers.test.ts` does it: the status,
 * the languages and the slots are all derived there, and the filters this file tests
 * run on top of them.
 */
const paperFile = (
  overrides: Partial<RawAdminSchoolPaperFile> = {}
): RawAdminSchoolPaperFile => ({
  language: "english",
  level: "whole",
  adviser_name: "Adviser",
  adviser_gender: "F",
  principal_name: "Principal",
  paper_staff: [],
  ...overrides,
});

const raw = (overrides: Partial<RawAdminSchoolPaper> = {}): RawAdminSchoolPaper => ({
  id: "s1",
  name: "Bagumbayan ES",
  district_id: "d1",
  is_integrated: false,
  level: null,
  paper_participation: "yes",
  submission_locked_at: null,
  districts: { name: "District I" },
  school_papers: [paperFile()],
  ...overrides,
});

const rows = toAdminSchoolPaperRows([
  raw(),
  raw({
    id: "s2",
    name: "Zamora ES",
    district_id: "d2",
    districts: { name: "District II" },
    submission_locked_at: "2026-08-14T03:00:00.000Z",
    school_papers: [paperFile({ language: "filipino" })],
  }),
  raw({
    id: "s3",
    name: "Malandag Integrated School",
    is_integrated: true,
    paper_participation: "no",
    school_papers: [],
  }),
]);

const ids = (filtered: { id: string }[]) => filtered.map((row) => row.id);
// The mapper sorts by district then school name. s1 and s3 are both District
// I, where Bagumbayan sorts before Malandag; s2 is the lone District II row.
const ALL = ["s1", "s3", "s2"];

describe("schoolPaperSearchQuery", () => {
  it("is null when the param is absent, empty or all spaces", () => {
    expect(schoolPaperSearchQuery({})).toBeNull();
    expect(schoolPaperSearchQuery({ q: "" })).toBeNull();
    expect(schoolPaperSearchQuery({ q: "   " })).toBeNull();
  });

  it("trims what it returns, so the message quotes the tidy form", () => {
    expect(schoolPaperSearchQuery({ q: "  zamora " })).toBe("zamora");
  });

  it("takes the first of a repeated param, as the filter bar's box does", () => {
    // `useSearchParams().get` returns the first, so the table has to agree with the
    // box about which one is showing.
    expect(schoolPaperSearchQuery({ q: ["zamora", "bagumbayan"] })).toBe("zamora");
  });

  it("survives an empty repeated param rather than throwing", () => {
    expect(schoolPaperSearchQuery({ q: [] })).toBeNull();
  });
});

describe("eligibleSchoolPaperRows", () => {
  it("drops a school with zero papers on file", () => {
    // s3 (Malandag) is the one row here with no school_papers at all.
    expect(ids(eligibleSchoolPaperRows(rows))).not.toContain("s3");
  });

  it("keeps a school with exactly one paper, any language or level", () => {
    expect(ids(eligibleSchoolPaperRows(rows))).toEqual(["s1", "s2"]);
  });
});

describe("filterSchoolPaperListRows", () => {
  it("returns every row when nothing is set", () => {
    expect(ids(filterSchoolPaperListRows(rows, {}))).toEqual(ALL);
  });

  it("matches the school name, case- and whitespace-insensitively", () => {
    expect(ids(filterSchoolPaperListRows(rows, { q: " ZAMORA " }))).toEqual(["s2"]);
  });

  it("matches a fragment anywhere in the name, not only the start", () => {
    // "integrated" is in the middle of the school's name, and typing part of a name
    // is how anyone looks for a school they cannot spell in full.
    expect(ids(filterSchoolPaperListRows(rows, { q: "integrated" }))).toEqual(["s3"]);
  });

  it("does not search the district, status or language, which have their own dropdowns", () => {
    expect(filterSchoolPaperListRows(rows, { q: "District II" })).toEqual([]);
    expect(filterSchoolPaperListRows(rows, { q: "filipino" })).toEqual([]);
    expect(filterSchoolPaperListRows(rows, { q: "locked" })).toEqual([]);
  });

  it("returns nothing for a query no row matches", () => {
    // The one filter here whose empty answer is the true answer.
    expect(filterSchoolPaperListRows(rows, { q: "qwerty" })).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(ids(filterSchoolPaperListRows(rows, { q: "  " }))).toEqual(ALL);
  });

  it("applies the search on top of the dropdowns, not instead of them", () => {
    expect(ids(filterSchoolPaperListRows(rows, { q: "a", district: "d1" }))).toEqual([
      "s1",
      "s3",
    ]);
    expect(
      ids(filterSchoolPaperListRows(rows, { q: "zamora", district: "d1" }))
    ).toEqual([]);
  });

  it("keeps the dropdown filters the page already had", () => {
    expect(ids(filterSchoolPaperListRows(rows, { district: "d2" }))).toEqual(["s2"]);
    expect(ids(filterSchoolPaperListRows(rows, { school: "s1" }))).toEqual(["s1"]);
    expect(ids(filterSchoolPaperListRows(rows, { lock: "locked" }))).toEqual(["s2"]);
    expect(ids(filterSchoolPaperListRows(rows, { language: "filipino" }))).toEqual([
      "s2",
    ]);
    expect(ids(filterSchoolPaperListRows(rows, { status: "incomplete" }))).toEqual([
      "s3",
    ]);
  });

  it("leaves the incoming order alone", () => {
    // The mapper sorts by school name; filtering must not reshuffle what survives.
    expect(ids(filterSchoolPaperListRows(rows, { q: "s" }))).toEqual(ALL);
  });
});

describe("schoolPaperEmptyState", () => {
  it("says no school has a paper on file when no control is set", () => {
    // Not "the roll is empty" — the roll is ~332 schools whether or not any of
    // them has filed a paper, and `eligibleSchoolPaperRows` runs before this.
    expect(schoolPaperEmptyState({})).toEqual({
      message: "No schools have a school paper on file yet.",
      narrowed: false,
    });
  });

  it("quotes the query back, so a typo is visible", () => {
    const state = schoolPaperEmptyState({ q: " qwerty " });
    expect(state.message).toBe("No schools match “qwerty”.");
    expect(state.narrowed).toBe(true);
  });

  it("names both causes when a query and a filter are set", () => {
    const state = schoolPaperEmptyState({ q: "zamora", district: "d1" });
    expect(state.message).toBe("No schools match “zamora” with these filters.");
    expect(state.narrowed).toBe(true);
  });

  it("keeps the filters-only wording the page already used", () => {
    expect(schoolPaperEmptyState({ district: "d1" })).toEqual({
      message: "No schools match these filters.",
      narrowed: true,
    });
  });

  it("counts every control the bar can set as narrowing", () => {
    // The list the Clear button counts. One missing here is a reader on a filtered
    // table being told the roll is empty.
    for (const filters of [
      { district: "d1" },
      { school: "s1" },
      { status: "submitted" },
      { lock: "unlocked" },
      { language: "english" },
    ]) {
      expect(schoolPaperEmptyState(filters).narrowed).toBe(true);
    }
  });

  it("is not narrowed by a blank query", () => {
    // Otherwise the table would offer a way back from a filter that is not on.
    expect(schoolPaperEmptyState({ q: "   " }).narrowed).toBe(false);
  });

  it("agrees with the row filter about which values are no filter at all", () => {
    // `filterSchoolPaperRows` treats an unrecognised URL value as no filter rather
    // than as a filter nothing matches, so a hand-edited URL cannot present an empty
    // table as if the division had no schools. The empty state has to read those same
    // values the same way, or `?lock=maybe` would show every row *and* offer a way
    // back from a filter that is off.
    for (const filters of [
      { status: "pending" },
      { lock: "maybe" },
      { language: "spanish" },
    ]) {
      expect(ids(filterSchoolPaperListRows(rows, filters))).toEqual(ALL);
      expect(schoolPaperEmptyState(filters).narrowed).toBe(false);
    }
  });
});
