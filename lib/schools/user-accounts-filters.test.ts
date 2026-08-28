import { describe, expect, it } from "vitest";

import {
  filterUserAccountRows,
  globalFreezeFromLock,
  submissionCellState,
  summariseUserAccounts,
  toUserAccountRows,
  userAccountsEmptyState,
  userAccountsSearchQuery,
  type RawUserAccountSchool,
} from "./user-accounts-filters";
import type { RevisionGrant } from "@/lib/submissions/revision-grant";

const raw = (over: Partial<RawUserAccountSchool> = {}): RawUserAccountSchool => ({
  id: "s1",
  name: "Alabel National High School",
  school_id_number: "300001",
  district_id: "d1",
  auth_user_id: "u1",
  submission_locked_at: null,
  districts: { name: "Alabel" },
  paper_participation: "undecided",
  entries: [{ count: 0 }],
  school_papers: [{ count: 0 }],
  revision_grants: [],
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

// The three conditions are ORed deliberately: a school that saved paper
// details, or answered the paper question either way, has started work its own
// dashboard shows it — so only a school with all three empty may be called
// closed. Each condition is exercised alone, because an OR that accidentally
// reads one field twice passes any test that sets two of them at once.
describe("toUserAccountRows: hasFiledAnything", () => {
  const filed = (over: Partial<RawUserAccountSchool>) =>
    toUserAccountRows([raw(over)])[0].hasFiledAnything;

  it("is false for a school with no entries, no paper and an unanswered question", () => {
    expect(filed({})).toBe(false);
  });

  it("is true on an entry alone", () => {
    expect(filed({ entries: [{ count: 1 }] })).toBe(true);
  });

  it("is true on a saved school paper alone", () => {
    expect(filed({ school_papers: [{ count: 1 }] })).toBe(true);
  });

  it("is true once the paper question is answered yes", () => {
    expect(filed({ paper_participation: "yes" })).toBe(true);
  });

  // Declining is an answer. A school that said no has finished deciding, and
  // calling that "nothing filed" would report its decision as inaction.
  it("is true once the paper question is answered no", () => {
    expect(filed({ paper_participation: "no" })).toBe(true);
  });

  // PostgREST returns `[]`, not `[{ count: 0 }]`, for a school with no related
  // rows, and a failed embed can arrive as null. Neither may read as filed.
  it("treats an empty or null embedded count as zero", () => {
    expect(filed({ entries: [], school_papers: null })).toBe(false);
  });

  it("treats a null paper_participation as unanswered", () => {
    expect(filed({ paper_participation: null })).toBe(false);
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

// The row keeps the wire shape. Resolving it is `activeGrant()`'s job, against
// the one `now` the page owns — so what is asserted here is only that the first
// element survives the mapping and that the two empty shapes both read as null.
describe("toUserAccountRows: grant", () => {
  const wire = {
    id: "g1",
    expires_at: "2026-08-28T08:19:00Z",
    granted_at: "2026-08-28T07:49:00Z",
    revoked_at: null,
    allow_paper: true,
    allow_roster: true,
    allow_entries: true,
  };

  it("carries the embedded row through untouched", () => {
    expect(toUserAccountRows([raw({ revision_grants: [wire] })])[0].grant).toEqual(wire);
  });

  // `[][0]` is `undefined`, which is not the value the row's type promises.
  it("is null for an empty embed, not undefined", () => {
    expect(toUserAccountRows([raw({ revision_grants: [] })])[0].grant).toBeNull();
  });

  it("is null when the embed came back null", () => {
    expect(toUserAccountRows([raw({ revision_grants: null })])[0].grant).toBeNull();
  });

  // Only one row can pass `revoked_at is null` under revision_grants_one_live, so
  // a second element means the select was written wrong; taking the first is
  // still the only defensible answer, and it is asserted rather than assumed.
  it("takes the first element when more than one comes back", () => {
    const second = { ...wire, id: "g2" };
    expect(
      toUserAccountRows([raw({ revision_grants: [wire, second] })])[0].grant?.id,
    ).toBe("g1");
  });
});

describe("submissionCellState", () => {
  const grant: RevisionGrant = {
    id: "g1",
    expiresAt: "2026-08-28T08:19:00Z",
    grantedAt: "2026-08-28T07:49:00Z",
    surfaces: ["paper", "roster", "entries"],
  };

  const state = (over: Partial<Parameters<typeof submissionCellState>[0]> = {}) =>
    submissionCellState({
      lockedAt: null,
      hasFiledAnything: true,
      grant: null,
      global: "open",
      ...over,
    });

  it("is open for an unlocked school under no division-wide lock", () => {
    expect(state()).toBe("open");
  });

  it("is locked for a school that locked itself", () => {
    expect(state({ lockedAt: "2026-08-20T01:00:00Z" })).toBe("locked");
  });

  it("is locked for every school under a division-wide lock", () => {
    expect(state({ global: "locked" })).toBe("locked");
  });

  // The guards are refusing every school-side write while the flag cannot be
  // read, so calling the row open would be the page contradicting the database.
  it("is locked while the division-wide switch is unreadable", () => {
    expect(state({ global: "unavailable" })).toBe("locked");
  });

  // The pair that is easy to get wrong, in both directions. Closed exists only
  // under the division-wide lock: outside one, a school with nothing filed is a
  // school that has not started and its window is still open.
  it("is open for a school that has filed nothing while the division lock is off", () => {
    expect(state({ hasFiledAnything: false })).toBe("open");
  });

  it("is closed for a school that has filed nothing while the division lock is on", () => {
    expect(state({ hasFiledAnything: false, global: "locked" })).toBe("closed");
  });

  it("is closed for a school that has filed nothing while the switch is unreadable", () => {
    expect(state({ hasFiledAnything: false, global: "unavailable" })).toBe("closed");
  });

  // Its own lock does not change the answer: with nothing filed there is still
  // nothing for Unlock to reopen, and the cell must not offer it.
  it("is closed rather than locked when the school locked itself and filed nothing", () => {
    expect(
      state({ hasFiledAnything: false, lockedAt: "2026-08-20T01:00:00Z", global: "locked" }),
    ).toBe("closed");
  });

  it("is locked, not closed, for a school under the division lock that has filed something", () => {
    expect(state({ hasFiledAnything: true, global: "locked" })).toBe("locked");
  });

  // A live grant is announced first, in every combination beneath it — 0031's
  // wrapper consults revision_allows() before either lock, so any other answer
  // here would be the row contradicting the guard.
  it("is revision under a division-wide lock", () => {
    expect(state({ grant, global: "locked" })).toBe("revision");
  });

  it("is revision over the school's own lock as well", () => {
    expect(state({ grant, lockedAt: "2026-08-20T01:00:00Z", global: "locked" })).toBe(
      "revision",
    );
  });

  it("is revision even for a school that has filed nothing", () => {
    expect(state({ grant, hasFiledAnything: false, global: "locked" })).toBe("revision");
  });

  // A grant outlives an unlock: the office lifts the deadline and the row stays
  // live for another twenty minutes. The cell still says so, because Revoke is
  // the only control that closes it and the row is where that control lives.
  it("is revision with no division-wide lock at all", () => {
    expect(state({ grant, global: "open" })).toBe("revision");
  });
});

describe("globalFreezeFromLock", () => {
  it("reads a set flag as locked", () => {
    expect(
      globalFreezeFromLock({ state: "locked", at: null, by: null, byName: null }),
    ).toBe("locked");
  });

  it("reads a clear flag as open", () => {
    expect(globalFreezeFromLock({ state: "unlocked" })).toBe("open");
  });

  // The missing singleton: the guard raises on it, so every school-side write is
  // already being refused and the cell must not call the row open.
  it("reads an unknown lock whose writes are refused as unavailable", () => {
    expect(
      globalFreezeFromLock({
        state: "unknown",
        reason: "no-row",
        detail: "no row",
        writes: "refused",
      }),
    ).toBe("unavailable");
  });

  // The regression `SubmissionsWrites` exists to prevent: a failed read that
  // established nothing — an expired JWT, a timeout, 0022 unapplied — must not
  // put 336 rows into a freeze the page never established.
  it("reads an unknown lock that established nothing as open", () => {
    expect(
      globalFreezeFromLock({
        state: "unknown",
        reason: "unreadable",
        detail: "network",
        writes: "undetermined",
      }),
    ).toBe("open");
  });

  it("reads an unknown lock whose writes are open as open", () => {
    expect(
      globalFreezeFromLock({
        state: "unknown",
        reason: "unreadable",
        detail: "relation does not exist",
        writes: "open",
      }),
    ).toBe("open");
  });
});
