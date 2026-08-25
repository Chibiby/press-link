import { describe, expect, it } from "vitest";

import {
  filterUserAccountRows,
  summariseUserAccounts,
  toUserAccountRows,
  userAccountsEmptyState,
  userAccountsSearchQuery,
  type RawUserAccountSchool,
} from "./user-accounts-filters";

const raw = (over: Partial<RawUserAccountSchool> = {}): RawUserAccountSchool => ({
  id: "s1",
  name: "Alabel National High School",
  school_id_number: "300001",
  district_id: "d1",
  auth_user_id: "u1",
  submission_locked_at: null,
  districts: { name: "Alabel" },
  ...over,
});

// s2 has never had a login provisioned; s3 is locked. Neither is s1, so each
// test below can tell which row a predicate kept by its id alone.
const rows = toUserAccountRows([
  raw(),
  raw({
    id: "s2",
    name: "Maasim Central ES",
    school_id_number: "300002",
    district_id: "d2",
    districts: { name: "Maasim" },
    auth_user_id: null,
  }),
  raw({
    id: "s3",
    name: "Malandag Integrated School",
    school_id_number: "300003",
    submission_locked_at: "2026-08-20T01:00:00Z",
  }),
]);

const ids = (rowsIn: { schoolId: string }[]) => rowsIn.map((row) => row.schoolId);
const ALL = ["s1", "s2", "s3"];

describe("toUserAccountRows", () => {
  it("maps a null auth_user_id to hasLogin: false and a set one to true", () => {
    expect(rows[0]).toMatchObject({ schoolId: "s1", hasLogin: true });
    expect(rows[1]).toMatchObject({ schoolId: "s2", hasLogin: false });
  });

  it("carries the district name across, and empties it when the join came back null", () => {
    expect(rows[0].districtName).toBe("Alabel");
    expect(toUserAccountRows([raw({ districts: null })])[0].districtName).toBe("");
  });

  it("carries the lock timestamp through unchanged", () => {
    expect(rows[0].lockedAt).toBeNull();
    expect(rows[2].lockedAt).toBe("2026-08-20T01:00:00Z");
  });
});

describe("userAccountsSearchQuery", () => {
  it("trims and empties an all-whitespace query", () => {
    expect(userAccountsSearchQuery({ q: "" })).toBeNull();
    expect(userAccountsSearchQuery({ q: "   " })).toBeNull();
  });

  it("trims a query that has content", () => {
    expect(userAccountsSearchQuery({ q: "  malandag " })).toBe("malandag");
  });

  it("takes the first value of a repeated q param", () => {
    expect(userAccountsSearchQuery({ q: ["maasim", "alabel"] })).toBe("maasim");
  });

  it("is null when q is an empty array", () => {
    expect(userAccountsSearchQuery({ q: [] })).toBeNull();
  });
});

describe("filterUserAccountRows", () => {
  it("returns every row when nothing is set", () => {
    expect(ids(filterUserAccountRows(rows, {}))).toEqual(ALL);
  });

  it("matches on the school name", () => {
    expect(ids(filterUserAccountRows(rows, { q: "maasim" }))).toEqual(["s2"]);
  });

  it("matches on the school id number", () => {
    expect(ids(filterUserAccountRows(rows, { q: "300003" }))).toEqual(["s3"]);
  });

  it("is case-insensitive and matches anywhere in the string", () => {
    expect(ids(filterUserAccountRows(rows, { q: "INTEGRATED" }))).toEqual(["s3"]);
  });

  it("narrows by district", () => {
    expect(ids(filterUserAccountRows(rows, { district: "d1" }))).toEqual(["s1", "s3"]);
  });

  it("combines district and search", () => {
    expect(ids(filterUserAccountRows(rows, { district: "d1", q: "malandag" }))).toEqual(["s3"]);
  });

  it("matches nothing when the query and the district disagree", () => {
    expect(ids(filterUserAccountRows(rows, { district: "d1", q: "maasim" }))).toEqual([]);
  });
});

describe("summariseUserAccounts", () => {
  it("counts schools with a login and schools with a lock over every row, not a filtered set", () => {
    expect(summariseUserAccounts(rows)).toEqual({
      totalSchools: 3,
      schoolsWithLogin: 2,
      lockedCount: 1,
    });
  });

  it("is all zero over an empty roll", () => {
    expect(summariseUserAccounts([])).toEqual({
      totalSchools: 0,
      schoolsWithLogin: 0,
      lockedCount: 0,
    });
  });
});

describe("userAccountsEmptyState", () => {
  it("names the query when search alone empties the table", () => {
    expect(userAccountsEmptyState({ q: "nonexistent" })).toEqual({
      message: "No schools match “nonexistent”.",
      narrowed: true,
    });
  });

  it("names both the query and the filter when both are set", () => {
    expect(userAccountsEmptyState({ q: "nonexistent", district: "d1" })).toEqual({
      message: "No schools match “nonexistent” with these filters.",
      narrowed: true,
    });
  });

  it("names the filter alone when only district is set", () => {
    expect(userAccountsEmptyState({ district: "d1" })).toEqual({
      message: "No schools match this filter.",
      narrowed: true,
    });
  });

  it("says nothing is on the roll when no filter is set", () => {
    expect(userAccountsEmptyState({})).toEqual({
      message: "No schools are on the division roll yet.",
      narrowed: false,
    });
  });

  it("treats an all-whitespace query as unset", () => {
    expect(userAccountsEmptyState({ q: "   " })).toEqual({
      message: "No schools are on the division roll yet.",
      narrowed: false,
    });
  });
});
