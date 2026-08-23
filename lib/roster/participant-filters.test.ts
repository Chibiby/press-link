import { describe, expect, it } from "vitest";

import { toAdminParticipantRows, type RawAdminParticipant } from "./admin-rows";
import {
  filterParticipantRows,
  participantEmptyState,
  participantSearchQuery,
} from "./participant-filters";

/**
 * Rows go through the real mapper rather than being written out as
 * `AdminParticipantRow` literals, the way `admin-coach-rows.test.ts` does it.
 * The filter searches `displayNumber` and reads `isMultiEvent`, both of which the
 * mapper derives — a hand-built row could hold an asterisk the mapper would
 * never produce, and the test would pass while the page did not.
 */
const raw = (overrides: Partial<RawAdminParticipant> = {}): RawAdminParticipant => ({
  id: "p1",
  participant_number: 7,
  first_name: "Ana",
  middle_name: null,
  last_name: "Dela Cruz",
  gender: "F",
  schools: {
    id: "s1",
    name: "Bagumbayan ES",
    district_id: "d1",
    paper_participation: "yes",
    submission_locked_at: null,
    paper_count: 2,
    districts: { name: "District I" },
  },
  entry_participants: [{ entry_id: "e1" }],
  ...overrides,
});

const otherSchool = {
  id: "s2",
  name: "Zamora ES",
  district_id: "d2",
  paper_participation: "yes",
  submission_locked_at: null,
  paper_count: 0,
  districts: { name: "District II" },
};

const rows = toAdminParticipantRows([
  raw(),
  raw({
    id: "p2",
    participant_number: 12,
    first_name: "Mario",
    last_name: "Reyes",
    gender: "M",
    entry_participants: [{ entry_id: "e1" }, { entry_id: "e2" }],
  }),
  raw({
    id: "p3",
    participant_number: 30,
    first_name: "Jose",
    last_name: "Santos",
    gender: "M",
    schools: otherSchool,
    entry_participants: [],
  }),
]);

const ids = (filtered: { id: string }[]) => filtered.map((row) => row.id);

describe("participantSearchQuery", () => {
  it("is null when the param is absent, empty or all spaces", () => {
    expect(participantSearchQuery({})).toBeNull();
    expect(participantSearchQuery({ q: "" })).toBeNull();
    expect(participantSearchQuery({ q: "   " })).toBeNull();
  });

  it("trims what it returns, so the message quotes the tidy form", () => {
    expect(participantSearchQuery({ q: "  cruz " })).toBe("cruz");
  });

  it("takes the first of a repeated param, as the filter bar's box does", () => {
    // `?q=cruz&q=reyes` arrives as an array. `useSearchParams().get` returns the
    // first, so the table has to agree with the box about which one is showing.
    expect(participantSearchQuery({ q: ["cruz", "reyes"] })).toBe("cruz");
  });

  it("survives an empty repeated param rather than throwing", () => {
    expect(participantSearchQuery({ q: [] })).toBeNull();
  });
});

describe("filterParticipantRows", () => {
  it("returns every row when nothing is set", () => {
    expect(ids(filterParticipantRows(rows, {}))).toEqual(["p1", "p2", "p3"]);
  });

  it("matches a name, case- and whitespace-insensitively", () => {
    expect(ids(filterParticipantRows(rows, { q: " CRUZ " }))).toEqual(["p1"]);
  });

  it("matches the school, so one school's learners can be listed by typing it", () => {
    expect(ids(filterParticipantRows(rows, { q: "zamora" }))).toEqual(["p3"]);
  });

  it("matches the participant number, with or without the multi-event asterisk", () => {
    expect(ids(filterParticipantRows(rows, { q: "0012" }))).toEqual(["p2"]);
    // The cell prints "*0012", so a pasted copy of it has to find the same row.
    expect(ids(filterParticipantRows(rows, { q: "*0012" }))).toEqual(["p2"]);
  });

  it("does not search the district, which has its own dropdown", () => {
    expect(ids(filterParticipantRows(rows, { q: "District II" }))).toEqual([]);
  });

  it("returns nothing for a query no row matches", () => {
    // The one filter here whose empty answer is the true answer.
    expect(filterParticipantRows(rows, { q: "qwerty" })).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(ids(filterParticipantRows(rows, { q: "  " }))).toEqual(["p1", "p2", "p3"]);
  });

  it("applies the search on top of the dropdowns, not instead of them", () => {
    expect(ids(filterParticipantRows(rows, { q: "a", district: "d1" }))).toEqual([
      "p1",
      "p2",
    ]);
    expect(ids(filterParticipantRows(rows, { q: "cruz", district: "d2" }))).toEqual([]);
  });

  it("keeps the district, school and toggle filters the page already had", () => {
    expect(ids(filterParticipantRows(rows, { district: "d2" }))).toEqual(["p3"]);
    expect(ids(filterParticipantRows(rows, { school: "s1" }))).toEqual(["p1", "p2"]);
    expect(ids(filterParticipantRows(rows, { multi: "1" }))).toEqual(["p2"]);
    expect(ids(filterParticipantRows(rows, { unassigned: "1" }))).toEqual(["p3"]);
  });

  it("treats an unrecognised toggle value as no filter", () => {
    // A hand-edited URL must not show an empty table as if the division had no
    // learners — the same rule as `filterCoachRows`.
    expect(ids(filterParticipantRows(rows, { multi: "yes" }))).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(ids(filterParticipantRows(rows, { unassigned: "0" }))).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("leaves the incoming order alone", () => {
    // The mapper sorts by number; filtering must not reshuffle what survives.
    expect(ids(filterParticipantRows(rows, { q: "bagumbayan" }))).toEqual(["p1", "p2"]);
  });
});

describe("participantEmptyState", () => {
  it("says the roster is empty only when no control is set", () => {
    expect(participantEmptyState({})).toEqual({
      message: "No participants are registered yet.",
      narrowed: false,
    });
  });

  it("quotes the query back, so a typo is visible", () => {
    const state = participantEmptyState({ q: " qwerty " });
    expect(state.message).toBe("No participants match “qwerty”.");
    expect(state.narrowed).toBe(true);
  });

  it("names both causes when a query and a filter are set", () => {
    const state = participantEmptyState({ q: "cruz", district: "d2" });
    expect(state.message).toBe("No participants match “cruz” with these filters.");
    expect(state.narrowed).toBe(true);
  });

  it("keeps the filters-only wording the page already used", () => {
    expect(participantEmptyState({ school: "s1" })).toEqual({
      message: "No participants match these filters.",
      narrowed: true,
    });
    expect(participantEmptyState({ multi: "1" }).narrowed).toBe(true);
    expect(participantEmptyState({ unassigned: "1" }).narrowed).toBe(true);
  });

  it("is not narrowed by a blank query or an unrecognised toggle", () => {
    // Otherwise the table would offer a way back from a filter that is not on.
    expect(participantEmptyState({ q: "   " }).narrowed).toBe(false);
    expect(participantEmptyState({ multi: "yes" }).narrowed).toBe(false);
  });
});
