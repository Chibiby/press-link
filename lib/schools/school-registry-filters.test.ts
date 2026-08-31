import { describe, expect, it } from "vitest";

import {
  applyQualifierCounts,
  categoryCountsBySchool,
  individualCountMode,
  qualifierCountsBySchool,
  schoolRegistryEmptyState,
  schoolRegistryExportFilename,
  schoolRegistryFiltersActive,
  schoolRegistryFiltersFromParams,
  schoolRegistrySearchQuery,
  schoolRegistryStatus,
  summariseSchoolRegistry,
  toRegistryRows,
  type CategoryCounts,
  type RawRegistryEntry,
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

// Per-category counts for s1 and s3 — s2 is deliberately absent, so its rows
// default to all-zero rather than throwing on a missing map entry.
const categoryCounts = new Map<string, CategoryCounts>([
  ["s1", { individualLearners: 5, individualCoaches: 2, groupLearners: 3, groupCoaches: 1 }],
  ["s3", { individualLearners: 8, individualCoaches: 2, groupLearners: 0, groupCoaches: 0 }],
]);

// In the order the query returns them — by name — because nothing here re-sorts.
const rows = toRegistryRows(
  [
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
  ],
  categoryCounts
);

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
    expect(toRegistryRows([raw({ districts: null })], new Map())[0].districtName).toBe("");
  });

  it("keeps the query's order", () => {
    expect(ids(rows)).toEqual(ALL);
  });

  it("reads the per-category counts off the map and defaults to zero when absent", () => {
    expect(rows[0]).toMatchObject({
      individualLearners: 5,
      individualCoaches: 2,
      groupLearners: 3,
      groupCoaches: 1,
    });
    // s2 has no entry in `categoryCounts` at all — no entry in either category —
    // and must not throw or read as `undefined`.
    expect(rows[1]).toMatchObject({
      individualLearners: 0,
      individualCoaches: 0,
      groupLearners: 0,
      groupCoaches: 0,
    });
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
  it("falls back to entered for an absent or junk value", () => {
    expect(schoolRegistryStatus({})).toBe("entered");
    expect(schoolRegistryStatus({ status: "nonsense" })).toBe("entered");
  });

  it("still resolves \"all\" when asked for explicitly", () => {
    expect(schoolRegistryStatus({ status: "all" })).toBe("all");
  });

  it("passes a recognised status through", () => {
    expect(schoolRegistryStatus({ status: "locked" })).toBe("locked");
  });
});

describe("summariseSchoolRegistry", () => {
  it("defaults to schools with entries when nothing is set, not the whole roll", () => {
    // schoolRegistryStatus now falls back to "entered" rather than "all" — a bare
    // visit to /admin/schools shows schools with at least one entry, not a
    // division-wide roster that is mostly nothing on record. Only s1 has entries.
    const summary = summariseSchoolRegistry(rows, {});
    expect(ids(summary.rows)).toEqual(["s1"]);
    expect(summary.shown).toBe(1);
    // The district-only denominator is unaffected by the status default.
    expect(summary.registered).toBe(3);
  });

  it("shows the whole roll when status is set to \"all\" explicitly", () => {
    const summary = summariseSchoolRegistry(rows, { status: "all" });
    expect(ids(summary.rows)).toEqual(ALL);
    expect(summary.shown).toBe(3);
    expect(summary.registered).toBe(3);
    expect(summary.totals).toEqual({
      individualLearners: 13,
      individualCoaches: 4,
      groupLearners: 3,
      groupCoaches: 1,
      // The four columns added, which is what a total column totals.
      delegates: 21,
    });
  });

  it("matches the school name, case- and whitespace-insensitively", () => {
    expect(
      ids(summariseSchoolRegistry(rows, { q: " MALANDAG ", status: "all" }).rows)
    ).toEqual(["s3"]);
  });

  it("matches the id number printed under the name", () => {
    // The officer's copy of the form has the number on it, so the number has to find
    // its own row.
    expect(
      ids(summariseSchoolRegistry(rows, { q: "300002", status: "all" }).rows)
    ).toEqual(["s2"]);
  });

  it("does not search the district, which has its own dropdown", () => {
    // "Alabel" is the district of both s1 and s3, and the name of only s1. If the
    // district were in the haystack this would return two rows and duplicate a
    // control that might be showing "All districts" at the same time.
    expect(
      ids(summariseSchoolRegistry(rows, { q: "alabel", status: "all" }).rows)
    ).toEqual(["s1"]);
  });

  it("returns nothing for a query no school matches", () => {
    // The one filter here whose empty answer is the true answer.
    expect(summariseSchoolRegistry(rows, { q: "qwerty", status: "all" }).rows).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(
      ids(summariseSchoolRegistry(rows, { q: "   ", status: "all" }).rows)
    ).toEqual(ALL);
  });

  it("keeps the district and status filters the page already had", () => {
    expect(
      ids(summariseSchoolRegistry(rows, { district: "d2", status: "all" }).rows)
    ).toEqual(["s2"]);
    expect(ids(summariseSchoolRegistry(rows, { status: "no-data" }).rows)).toEqual([
      "s2",
    ]);
    expect(
      ids(summariseSchoolRegistry(rows, { status: "learners-no-entry" }).rows)
    ).toEqual(["s3"]);
  });

  it("falls back to entered for a junk status rather than an empty table", () => {
    expect(ids(summariseSchoolRegistry(rows, { status: "nonsense" }).rows)).toEqual(["s1"]);
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
    // and stops being a comparison. Status pinned to "all" so this test is about
    // the district/search interaction, not the status default.
    const searched = summariseSchoolRegistry(rows, {
      q: "malandag",
      district: "d1",
      status: "all",
    });
    expect(searched.shown).toBe(1);
    expect(searched.registered).toBe(2);

    const district = summariseSchoolRegistry(rows, { district: "d1", status: "all" });
    expect(district.shown).toBe(2);
    expect(district.registered).toBe(2);

    // Status is a view filter too, and always was.
    expect(summariseSchoolRegistry(rows, { status: "no-data" }).registered).toBe(3);
  });

  it("sums the columns over the rows on screen and no others", () => {
    // The footer prints these totals directly under the rows, so a sum taken before
    // the search ran would contradict what is above it.
    expect(
      summariseSchoolRegistry(rows, { q: "malandag", status: "all" }).totals
    ).toEqual({
      individualLearners: 8,
      individualCoaches: 2,
      groupLearners: 0,
      groupCoaches: 0,
      delegates: 10,
    });
  });

  it("leaves the incoming order alone", () => {
    expect(ids(summariseSchoolRegistry(rows, { q: "a", status: "all" }).rows)).toEqual(ALL);
  });
});

describe("schoolRegistryEmptyState", () => {
  it("says no schools match filters for a bare visit, now that the default is entered-only", () => {
    // schoolRegistryStatus({}) is now "entered", not "all" — so `otherFilters`
    // (`schoolRegistryStatus(filters) !== "all"`) is true even with no control
    // touched, and a bare visit that finds nothing reads as filtered rather than
    // as "the roll itself is empty", which would be false with schools on file.
    expect(schoolRegistryEmptyState({})).toEqual({
      message: "No schools match these filters.",
      narrowed: true,
    });
  });

  it("says the roll is empty only when status is set to \"all\" explicitly", () => {
    expect(schoolRegistryEmptyState({ status: "all" })).toEqual({
      message: "No schools are on the division roll yet.",
      narrowed: false,
    });
  });

  it("quotes the query back, so a typo is visible", () => {
    const state = schoolRegistryEmptyState({ q: " qwerty ", status: "all" });
    expect(state.message).toBe("No schools match “qwerty”.");
    expect(state.narrowed).toBe(true);
  });

  it("names both causes when a query and a filter are set", () => {
    const state = schoolRegistryEmptyState({ q: "malandag", status: "locked" });
    expect(state.message).toBe("No schools match “malandag” with these filters.");
    expect(state.narrowed).toBe(true);
  });

  it("offers a way back from either dropdown on its own", () => {
    expect(schoolRegistryEmptyState({ district: "d1", status: "all" })).toEqual({
      message: "No schools match these filters.",
      narrowed: true,
    });
    expect(schoolRegistryEmptyState({ status: "locked" }).narrowed).toBe(true);
  });

  it("is not narrowed by a blank query once status is pinned to \"all\"", () => {
    // "all" is the dropdown's explicit "show everything" option, so choosing it
    // is not narrowing anything, and neither is an empty search box on top of it.
    expect(schoolRegistryEmptyState({ q: "   ", status: "all" }).narrowed).toBe(false);
    expect(schoolRegistryEmptyState({ status: "all" }).narrowed).toBe(false);
  });

  it("is narrowed by an absent or junk status now that the default is \"entered\"", () => {
    // A junk value used to fall back to "all" and count as unfiltered; it now
    // falls back to "entered", so it — like a bare visit — offers a way back to
    // the whole roll instead of silently passing off schools-with-entries as
    // the complete list.
    expect(schoolRegistryEmptyState({}).narrowed).toBe(true);
    expect(schoolRegistryEmptyState({ q: "   " }).narrowed).toBe(true);
    expect(schoolRegistryEmptyState({ status: "nonsense" }).narrowed).toBe(true);
  });
});

function entryRow(over: Partial<RawRegistryEntry> = {}): RawRegistryEntry {
  return {
    school_id: "s1",
    events: { category: "individual" },
    entry_participants: [{ participants: { id: "p1" } }],
    entry_coaches: [{ coaches: { id: "c1" } }],
    ...over,
  };
}

describe("categoryCountsBySchool", () => {
  it("dedups a learner or coach seen on more than one entry in the same category", () => {
    // A coach on two contestants, or a contestant repeated across two entries, is
    // one person and counts once — the same principle distinctCoaches applies to
    // a single entry's link rows, folded across a school's whole entry list.
    const counts = categoryCountsBySchool([
      entryRow({
        entry_participants: [{ participants: { id: "p1" } }, { participants: { id: "p2" } }],
        entry_coaches: [{ coaches: { id: "c1" } }],
      }),
      entryRow({
        entry_participants: [{ participants: { id: "p1" } }],
        entry_coaches: [{ coaches: { id: "c1" } }],
      }),
    ]);
    expect(counts.get("s1")).toEqual({
      individualLearners: 2,
      individualCoaches: 1,
      groupLearners: 0,
      groupCoaches: 0,
    });
  });

  it("counts the same person once per category, independently in each", () => {
    // A coach who takes an individual entry and a group entry at the same school
    // is one individual coach and one group coach, not one coach overall.
    const counts = categoryCountsBySchool([
      entryRow({ events: { category: "individual" }, entry_coaches: [{ coaches: { id: "c1" } }] }),
      entryRow({ events: { category: "group" }, entry_coaches: [{ coaches: { id: "c1" } }] }),
    ]);
    expect(counts.get("s1")).toEqual({
      individualLearners: 1,
      individualCoaches: 1,
      groupLearners: 1,
      groupCoaches: 1,
    });
  });

  it("keeps counts separate per school", () => {
    const counts = categoryCountsBySchool([
      entryRow({ school_id: "s1" }),
      entryRow({ school_id: "s2", entry_participants: [{ participants: { id: "p9" } }] }),
    ]);
    expect(counts.get("s1")?.individualLearners).toBe(1);
    expect(counts.get("s2")?.individualLearners).toBe(1);
  });

  it("contributes to neither category when the event join came back null", () => {
    // A dangling FK must not crash the aggregation, and must not be guessed into
    // either category.
    const counts = categoryCountsBySchool([entryRow({ events: null })]);
    expect(counts.has("s1")).toBe(false);
  });

  it("ignores a null participant or coach link rather than counting it", () => {
    const counts = categoryCountsBySchool([
      entryRow({
        entry_participants: [{ participants: null }, { participants: { id: "p1" } }],
        entry_coaches: [{ coaches: null }],
      }),
    ]);
    expect(counts.get("s1")).toEqual({
      individualLearners: 1,
      individualCoaches: 0,
      groupLearners: 0,
      groupCoaches: 0,
    });
  });
});

describe("schoolRegistryFiltersFromParams", () => {
  it("reads q, district and status off a URLSearchParams-shaped object", () => {
    const params = new URLSearchParams({ q: "alabel", district: "d1", status: "locked" });
    expect(schoolRegistryFiltersFromParams(params)).toEqual({
      q: "alabel",
      district: "d1",
      status: "locked",
    });
  });

  it("leaves an absent param undefined, matching what the page's plain object carries", () => {
    expect(schoolRegistryFiltersFromParams(new URLSearchParams())).toEqual({
      q: undefined,
      district: undefined,
      status: undefined,
    });
  });
});

describe("schoolRegistryFiltersActive", () => {
  it("is false only when status is pinned to \"all\" and nothing else is set", () => {
    expect(schoolRegistryFiltersActive({ status: "all" })).toBe(false);
  });

  it("is true whenever search, district, or a status other than \"all\" narrows the view", () => {
    // Search-inclusive, unlike schoolRegistryEmptyState's internal check — this is
    // used only by the export filename, which has one word for any narrowing.
    // The default status is now "entered", not "all", so even a bare set of
    // filters counts as narrowing unless "all" is asked for by name.
    expect(schoolRegistryFiltersActive({})).toBe(true);
    expect(schoolRegistryFiltersActive({ q: "alabel", status: "all" })).toBe(true);
    expect(schoolRegistryFiltersActive({ district: "d1", status: "all" })).toBe(true);
    expect(schoolRegistryFiltersActive({ status: "locked" })).toBe(true);
  });
});

describe("schoolRegistryExportFilename", () => {
  it("carries no \"filtered\" marker only when status is explicitly \"all\"", () => {
    expect(schoolRegistryExportFilename({ status: "all" }, "2026-08-24")).toBe(
      "press-link-schools-2026-08-24.xlsx"
    );
  });

  it("marks the file filtered whenever a control — including the entered-only default — narrows it", () => {
    expect(schoolRegistryExportFilename({}, "2026-08-24")).toBe(
      "press-link-schools-filtered-2026-08-24.xlsx"
    );
    expect(
      schoolRegistryExportFilename({ district: "d1", status: "all" }, "2026-08-24")
    ).toBe("press-link-schools-filtered-2026-08-24.xlsx");
  });
});

describe("qualifierCountsBySchool", () => {
  const q = (participantId: string, entryId: string, schoolId: string | null) => ({
    participant_id: participantId,
    entry_id: entryId,
    entries: schoolId ? { school_id: schoolId } : null,
  });

  it("counts a learner once however many events they qualified in", () => {
    // The column counts people. A contestant through in two contests is one learner
    // going to round 2, not two.
    const counts = qualifierCountsBySchool([q("p1", "e1", "s1"), q("p1", "e2", "s1")], []);
    expect(counts.get("s1")?.individualLearners).toBe(1);
  });

  it("counts the coach paired with a qualifier", () => {
    const counts = qualifierCountsBySchool(
      [q("p1", "e1", "s1")],
      [{ entry_id: "e1", coach_id: "c1", participant_id: "p1" }]
    );
    expect(counts.get("s1")?.individualCoaches).toBe(1);
  });

  it("does not count a coach whose contestant was eliminated", () => {
    // Three contestants on one entry, one through. Counting the whole entry's
    // advisers would report coaches as qualifying because somebody else did.
    const counts = qualifierCountsBySchool(
      [q("p1", "e1", "s1")],
      [
        { entry_id: "e1", coach_id: "c1", participant_id: "p1" },
        { entry_id: "e1", coach_id: "c2", participant_id: "p2" },
      ]
    );
    expect(counts.get("s1")?.individualCoaches).toBe(1);
  });

  it("counts one adviser once when they coach two qualifiers", () => {
    const counts = qualifierCountsBySchool(
      [q("p1", "e1", "s1"), q("p2", "e1", "s1")],
      [
        { entry_id: "e1", coach_id: "c1", participant_id: "p1" },
        { entry_id: "e1", coach_id: "c1", participant_id: "p2" },
      ]
    );
    expect(counts.get("s1")).toEqual({ individualLearners: 2, individualCoaches: 1 });
  });

  it("counts an unpaired coach on a qualifying entry", () => {
    // A pre-0019 row that never recorded who the coach was for. Dropping it would
    // report a qualifying contestant as having no coach at all.
    const counts = qualifierCountsBySchool(
      [q("p1", "e1", "s1")],
      [{ entry_id: "e1", coach_id: "c1", participant_id: null }]
    );
    expect(counts.get("s1")?.individualCoaches).toBe(1);
  });

  it("ignores a coach on an entry nobody qualified from", () => {
    const counts = qualifierCountsBySchool(
      [q("p1", "e1", "s1")],
      [{ entry_id: "e9", coach_id: "c9", participant_id: "p9" }]
    );
    expect(counts.get("s1")?.individualCoaches).toBe(0);
  });

  it("drops a qualifier whose entry join came back null rather than crashing", () => {
    // The same treatment a dangling event join gets in categoryCountsBySchool: it
    // must not be attributed to an arbitrary school.
    const counts = qualifierCountsBySchool([q("p1", "e1", null)], []);
    expect(counts.size).toBe(0);
  });

  it("keeps schools apart", () => {
    const counts = qualifierCountsBySchool([q("p1", "e1", "s1"), q("p2", "e2", "s2")], []);
    expect(counts.get("s1")?.individualLearners).toBe(1);
    expect(counts.get("s2")?.individualLearners).toBe(1);
  });
});

describe("applyQualifierCounts", () => {
  const row = {
    schoolId: "s1",
    schoolName: "Bagong Silang ES",
    schoolIdNumber: "123456",
    districtId: "d1",
    districtName: "Alabel",
    isIntegrated: false,
    learners: 10,
    coaches: 4,
    entries: 3,
    individualLearners: 8,
    individualCoaches: 3,
    groupLearners: 7,
    groupCoaches: 2,
    lockedAt: null,
  };

  it("replaces the individual figures and leaves the group ones alone", () => {
    // A group contest has no second round to qualify for, so "group qualifiers" is
    // not a quantity that exists.
    const [out] = applyQualifierCounts(
      [row],
      new Map([["s1", { individualLearners: 2, individualCoaches: 1 }]])
    );
    expect(out.individualLearners).toBe(2);
    expect(out.individualCoaches).toBe(1);
    expect(out.groupLearners).toBe(7);
    expect(out.groupCoaches).toBe(2);
  });

  it("gives a school that got nobody through a measured nought", () => {
    const [out] = applyQualifierCounts([row], new Map());
    expect(out.individualLearners).toBe(0);
    expect(out.individualCoaches).toBe(0);
  });
});

describe("individualCountMode", () => {
  it("reads the round-2 view off the param", () => {
    expect(individualCountMode({ individual: "qualifiers" })).toBe("qualifiers");
  });

  it("falls back to everybody entered on anything else", () => {
    // A mistyped param must not quietly narrow the roll to schools that got somebody
    // through round 1.
    expect(individualCountMode({})).toBe("all");
    expect(individualCountMode({ individual: "all" })).toBe("all");
    expect(individualCountMode({ individual: "QUALIFIERS" })).toBe("all");
  });
});

describe("the round 2 qualifiers view narrows the table", () => {
  // s1 and s3 have individual counts in the fixture; s2 has none at all. Under this
  // mode the counts are the qualifier counts, so a nought means nobody went through.
  const qualifying = applyQualifierCounts(
    rows,
    new Map([["s1", { individualLearners: 2, individualCoaches: 1 }]])
  );

  it("shows only the schools with somebody in round 2", () => {
    // The behaviour this replaced kept every school and printed two noughts. The
    // answer a reader wants from "Round 2 qualifiers" is the list of schools that
    // have somebody in round 2, and three hundred rows of noughts buries it.
    const summary = summariseSchoolRegistry(qualifying, {
      status: "all",
      individual: "qualifiers",
    });
    expect(summary.rows.map((row) => row.schoolId)).toEqual(["s1"]);
    expect(summary.shown).toBe(1);
  });

  it("keeps the denominator on the whole roll, so the heading still says 1 of 3", () => {
    // `registered` is the population the district selects, not what this view left
    // of it — otherwise the subtitle would read "1 of 1" and say nothing.
    const summary = summariseSchoolRegistry(qualifying, {
      status: "all",
      individual: "qualifiers",
    });
    expect(summary.registered).toBe(3);
  });

  it("totals only the schools it shows", () => {
    const summary = summariseSchoolRegistry(qualifying, {
      status: "all",
      individual: "qualifiers",
    });
    expect(summary.totals.individualLearners).toBe(2);
    expect(summary.totals.individualCoaches).toBe(1);
    // s1's group figures, which this view never touches: a group contest has no
    // second round, so those columns print what the school has.
    expect(summary.totals.groupLearners).toBe(3);
    expect(summary.totals.groupCoaches).toBe(1);
  });

  it("leaves every school on the table when the view is off", () => {
    expect(summariseSchoolRegistry(rows, { status: "all" }).shown).toBe(3);
  });

  it("narrows within a district rather than instead of it", () => {
    const summary = summariseSchoolRegistry(qualifying, {
      status: "all",
      district: "d2",
      individual: "qualifiers",
    });
    // s2 is the only school in d2 and it has no qualifiers.
    expect(summary.rows).toEqual([]);
  });

  it("says nobody is through rather than blaming the filters", () => {
    // The one narrowing whose empty table is most likely to be the truth: no round 1
    // has been closed yet. "No schools match these filters" would send an officer
    // looking for a control to undo.
    const empty = schoolRegistryEmptyState({ individual: "qualifiers" });
    expect(empty.message).toContain("through to round 2");
    expect(empty.narrowed).toBe(true);
  });

  it("counts as an active filter, so the workbook is named a filtered one", () => {
    expect(schoolRegistryFiltersActive({ status: "all", individual: "qualifiers" })).toBe(true);
    // `status: "all"` is spelled out because an unset status is itself a narrowing —
    // the registry defaults to "Has entries" — so it would carry this assertion.
    expect(schoolRegistryFiltersActive({ status: "all", individual: "all" })).toBe(false);
  });
});
