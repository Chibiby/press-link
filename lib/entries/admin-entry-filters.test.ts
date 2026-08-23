import { describe, expect, it } from "vitest";

import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import {
  entriesExportFilename,
  entryCoachNames,
  entryEmptyState,
  entryFiltersActive,
  entryFiltersFromParams,
  entryParticipantNames,
  entrySearchQuery,
  filterEntryRows,
} from "./admin-entry-filters";

/**
 * Rows are written in the shape `/admin/entries` selects, because that page has no
 * row mapper: it hands the Supabase rows to the filter and renders them directly.
 * So the raw shape *is* the real input, and the display strings the search matches
 * on are derived here by the same exported helpers the table's cells call — a
 * hand-written "Dela Cruz, Ana" in a fixture would let this file pass while the
 * screen printed something else.
 *
 * The extra columns (`participant_number`, the school and event names) are kept in
 * the fixture on purpose: they are in the page's select, and their absence from
 * the haystack is a decision this file tests rather than an accident of a
 * trimmed-down fixture.
 */
interface TestEntryRow {
  id: string;
  submitted_at: string;
  schools: {
    name: string;
    district_id: string;
    districts: { name: string } | null;
  } | null;
  events: {
    name: string;
    category: EventCategory;
    level: EventLevel;
    language: EventLanguage;
  } | null;
  entry_participants: {
    participants: {
      participant_number: number;
      first_name: string;
      last_name: string;
    } | null;
  }[];
  entry_coaches: {
    coaches: {
      id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    } | null;
  }[];
}

const rows: TestEntryRow[] = [
  {
    id: "e1",
    submitted_at: "2026-03-01T02:00:00Z",
    schools: {
      name: "Bagumbayan ES",
      district_id: "d1",
      districts: { name: "District I" },
    },
    events: {
      name: "News Writing",
      category: "individual",
      level: "elementary",
      language: "english",
    },
    entry_participants: [
      { participants: { participant_number: 7, first_name: "Ana", last_name: "Dela Cruz" } },
    ],
    entry_coaches: [
      { coaches: { id: "c1", first_name: "Mario", middle_name: "Santos", last_name: "Reyes" } },
    ],
  },
  {
    id: "e2",
    submitted_at: "2026-02-20T01:00:00Z",
    schools: {
      name: "Zamora ES",
      district_id: "d2",
      districts: { name: "District II" },
    },
    events: {
      name: "Radio Broadcasting and Scriptwriting (Regular)",
      category: "group",
      level: "secondary",
      language: "filipino",
    },
    entry_participants: [
      { participants: { participant_number: 12, first_name: "Jose", last_name: "Santos" } },
      { participants: { participant_number: 13, first_name: "Mia", last_name: "Lim" } },
    ],
    // The same coach twice: `entry_coaches` holds one row per coach per
    // contestant, so a coach taking two members of a group entry is two rows
    // naming one person.
    entry_coaches: [
      { coaches: { id: "c2", first_name: "Luz", middle_name: null, last_name: "Garcia" } },
      { coaches: { id: "c2", first_name: "Luz", middle_name: null, last_name: "Garcia" } },
    ],
  },
  {
    // A link whose join came back null — a contestant or coach deleted under the
    // read. The filter has to survive it rather than 500 the page.
    id: "e3",
    submitted_at: "2026-02-01T01:00:00Z",
    schools: {
      name: "Bagumbayan ES",
      district_id: "d1",
      districts: { name: "District I" },
    },
    events: {
      name: "Pagsulat ng Editoryal",
      category: "individual",
      level: "secondary",
      language: "filipino",
    },
    entry_participants: [{ participants: null }],
    entry_coaches: [{ coaches: null }],
  },
];

const ids = (filtered: { id: string }[]) => filtered.map((row) => row.id);

describe("entryParticipantNames / entryCoachNames", () => {
  it("prints contestants first name first, as the Participant(s) cell does", () => {
    expect(entryParticipantNames(rows[1])).toEqual(["Jose Santos", "Mia Lim"]);
  });

  it("prints coaches surname first, deduped by person, as the Coach(es) cell does", () => {
    expect(entryCoachNames(rows[0])).toEqual(["Reyes, Mario Santos"]);
    expect(entryCoachNames(rows[1])).toEqual(["Garcia, Luz"]);
  });

  it("drops a link whose join is null instead of printing an empty name", () => {
    expect(entryParticipantNames(rows[2])).toEqual([]);
    expect(entryCoachNames(rows[2])).toEqual([]);
  });
});

describe("entrySearchQuery", () => {
  it("is null when the param is absent, empty or all spaces", () => {
    expect(entrySearchQuery({})).toBeNull();
    expect(entrySearchQuery({ q: "" })).toBeNull();
    expect(entrySearchQuery({ q: "   " })).toBeNull();
  });

  it("trims what it returns, so the message quotes the tidy form", () => {
    expect(entrySearchQuery({ q: "  cruz " })).toBe("cruz");
  });

  it("takes the first of a repeated param, as the filter bar's box does", () => {
    expect(entrySearchQuery({ q: ["cruz", "reyes"] })).toBe("cruz");
  });

  it("survives an empty repeated param rather than throwing", () => {
    expect(entrySearchQuery({ q: [] })).toBeNull();
  });
});

describe("filterEntryRows", () => {
  it("returns every row when nothing is set", () => {
    expect(ids(filterEntryRows(rows, {}))).toEqual(["e1", "e2", "e3"]);
  });

  it("matches a contestant's name, case- and whitespace-insensitively", () => {
    expect(ids(filterEntryRows(rows, { q: " CRUZ " }))).toEqual(["e1"]);
    expect(ids(filterEntryRows(rows, { q: "ana dela cruz" }))).toEqual(["e1"]);
  });

  it("matches a coach, in the surname-first form the cell prints", () => {
    expect(ids(filterEntryRows(rows, { q: "Reyes, Mario" }))).toEqual(["e1"]);
    // Nothing else on this page can find a coach: there is no coach dropdown.
    expect(ids(filterEntryRows(rows, { q: "garcia" }))).toEqual(["e2"]);
  });

  it("matches across both name columns at once", () => {
    // "Santos" is e1's coach's middle name and e2's contestant's surname.
    expect(ids(filterEntryRows(rows, { q: "santos" }))).toEqual(["e1", "e2"]);
  });

  it("does not search the school, district or event, which have their own dropdowns", () => {
    expect(filterEntryRows(rows, { q: "Zamora" })).toEqual([]);
    expect(filterEntryRows(rows, { q: "District II" })).toEqual([]);
    expect(filterEntryRows(rows, { q: "News Writing" })).toEqual([]);
  });

  it("does not search level, language or category, which have their own dropdowns", () => {
    expect(filterEntryRows(rows, { q: "secondary" })).toEqual([]);
    expect(filterEntryRows(rows, { q: "filipino" })).toEqual([]);
    expect(filterEntryRows(rows, { q: "group" })).toEqual([]);
  });

  it("does not search a number the table never prints", () => {
    // `participant_number` is in the select but in no cell, so a match on it
    // would put a row on screen for a reason the screen does not show.
    expect(filterEntryRows(rows, { q: "0012" })).toEqual([]);
    expect(filterEntryRows(rows, { q: "12" })).toEqual([]);
  });

  it("returns nothing for a query no row matches", () => {
    // The one filter here whose empty answer is the true answer.
    expect(filterEntryRows(rows, { q: "qwerty" })).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(ids(filterEntryRows(rows, { q: "  " }))).toEqual(["e1", "e2", "e3"]);
  });

  it("applies the search on top of the dropdowns, not instead of them", () => {
    expect(ids(filterEntryRows(rows, { q: "santos", district: "d2" }))).toEqual(["e2"]);
    expect(ids(filterEntryRows(rows, { q: "cruz", district: "d2" }))).toEqual([]);
  });

  it("keeps the district, category, level and language filters the page already had", () => {
    expect(ids(filterEntryRows(rows, { district: "d2" }))).toEqual(["e2"]);
    expect(ids(filterEntryRows(rows, { category: "group" }))).toEqual(["e2"]);
    expect(ids(filterEntryRows(rows, { level: "secondary" }))).toEqual(["e2", "e3"]);
    expect(ids(filterEntryRows(rows, { language: "filipino" }))).toEqual(["e2", "e3"]);
  });

  it("treats an unrecognised category, level or language as no filter", () => {
    // A hand-edited URL must not hand an administrator an empty table, or an
    // empty workbook, that reads as a division with no entries.
    expect(ids(filterEntryRows(rows, { category: "solo" }))).toEqual(["e1", "e2", "e3"]);
    expect(ids(filterEntryRows(rows, { level: "elem" }))).toEqual(["e1", "e2", "e3"]);
    expect(ids(filterEntryRows(rows, { language: "tagalog" }))).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
  });

  it("leaves the incoming order alone", () => {
    // The query orders by submission, newest first; filtering must not reshuffle
    // what survives.
    expect(ids(filterEntryRows(rows, { district: "d1" }))).toEqual(["e1", "e3"]);
  });
});

describe("entryFiltersFromParams", () => {
  it("reads every key off a URLSearchParams and leaves the rest undefined", () => {
    expect(entryFiltersFromParams(new URLSearchParams("q=cruz&level=secondary"))).toEqual({
      q: "cruz",
      district: undefined,
      school: undefined,
      event: undefined,
      category: undefined,
      level: "secondary",
      language: undefined,
    });
  });

  it("takes the first of a repeated param, as the page's array read does", () => {
    expect(entryFiltersFromParams(new URLSearchParams("q=cruz&q=reyes")).q).toBe("cruz");
  });

  it("selects the same rows the page's params object does", () => {
    // Export parity, in one assertion: the route reads a `URLSearchParams` and the
    // page reads an object, and both go through this module. If they ever stop
    // agreeing, the downloaded workbook stops matching the screen it was taken
    // from — and nothing on the file would say so.
    const url = new URLSearchParams("q=+SANTOS+&district=d2&level=secondary");
    expect(ids(filterEntryRows(rows, entryFiltersFromParams(url)))).toEqual(
      ids(filterEntryRows(rows, { q: " SANTOS ", district: "d2", level: "secondary" }))
    );
    expect(ids(filterEntryRows(rows, entryFiltersFromParams(url)))).toEqual(["e2"]);
  });
});

describe("entryFiltersActive", () => {
  it("is false when nothing narrows the view", () => {
    expect(entryFiltersActive({})).toBe(false);
    expect(entryFiltersActive({ q: "   " })).toBe(false);
    expect(entryFiltersActive({ level: "elem" })).toBe(false);
  });

  it("is true for a query or any recognised filter", () => {
    expect(entryFiltersActive({ q: "cruz" })).toBe(true);
    expect(entryFiltersActive({ district: "d1" })).toBe(true);
    // Applied in the query rather than in the row filter, but still a narrowing.
    expect(entryFiltersActive({ school: "s1" })).toBe(true);
    expect(entryFiltersActive({ event: "ev1" })).toBe(true);
    expect(entryFiltersActive({ category: "group" })).toBe(true);
  });
});

describe("entryEmptyState", () => {
  it("says nothing has been submitted only when no control is set", () => {
    expect(entryEmptyState({})).toEqual({
      message: "No entries have been submitted yet.",
      narrowed: false,
    });
  });

  it("quotes the query back, so a typo is visible", () => {
    const state = entryEmptyState({ q: " qwerty " });
    expect(state.message).toBe("No entries match “qwerty”.");
    expect(state.narrowed).toBe(true);
  });

  it("names both causes when a query and a filter are set", () => {
    const state = entryEmptyState({ q: "cruz", district: "d2" });
    expect(state.message).toBe("No entries match “cruz” with these filters.");
    expect(state.narrowed).toBe(true);
  });

  it("keeps the filters-only wording the page already used", () => {
    expect(entryEmptyState({ school: "s1" })).toEqual({
      message: "No entries match these filters.",
      narrowed: true,
    });
    expect(entryEmptyState({ event: "ev1" }).narrowed).toBe(true);
  });

  it("is not narrowed by a blank query or an unrecognised value", () => {
    // Otherwise the table would offer a way back from a filter that is not on.
    expect(entryEmptyState({ q: "   " }).narrowed).toBe(false);
    expect(entryEmptyState({ level: "elem" }).narrowed).toBe(false);
  });
});

describe("entriesExportFilename", () => {
  it("names the plain file when the whole division is in it", () => {
    expect(entriesExportFilename({}, "2026-08-23")).toBe(
      "press-link-entries-2026-08-23.xlsx"
    );
  });

  it("says the file is filtered whenever a control narrowed it", () => {
    // The workbook outlives the screen, so its scope has to travel with it.
    expect(entriesExportFilename({ q: "cruz" }, "2026-08-23")).toBe(
      "press-link-entries-filtered-2026-08-23.xlsx"
    );
    expect(entriesExportFilename({ school: "s1" }, "2026-08-23")).toBe(
      "press-link-entries-filtered-2026-08-23.xlsx"
    );
  });

  it("does not call a file filtered over a blank query or a bad value", () => {
    expect(entriesExportFilename({ q: " " }, "2026-08-23")).toBe(
      "press-link-entries-2026-08-23.xlsx"
    );
    expect(entriesExportFilename({ level: "elem" }, "2026-08-23")).toBe(
      "press-link-entries-2026-08-23.xlsx"
    );
  });
});
