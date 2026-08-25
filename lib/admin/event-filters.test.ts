import { describe, expect, it } from "vitest";

import { buildEventMatrix, type EventMatrixInput } from "@/lib/dashboard/event-matrix";
import {
  eventEmptyState,
  eventSearchQuery,
  eventsExportFilename,
  eventTypeCountLabel,
  filterEventRows,
} from "./event-filters";

/**
 * Rows go through `buildEventMatrix` rather than being written out as
 * `EventMatrixRow` literals, the way `participant-filters.test.ts` goes through
 * `toAdminParticipantRows`. The filter searches the two name fields and the page
 * reads the rows out of `matrix.individual` / `matrix.group`, both of which the
 * fold derives — a hand-built row could carry a category that disagreed with the
 * section it was in, and the test would pass while the page did not.
 */
function slot(over: Partial<EventMatrixInput> = {}): EventMatrixInput {
  return {
    eventId: "e1",
    typeId: "news",
    typeNameEn: "News Writing",
    typeNameFil: "Pagsulat ng Balita",
    category: "individual",
    minParticipants: 1,
    maxParticipants: 3,
    sortOrder: 1,
    level: "elementary",
    language: "english",
    entries: 0,
    ...over,
  };
}

/** News Writing at two slots, Feature Writing, MOJO, and one group type. */
const matrix = buildEventMatrix([
  slot({ eventId: "n-ee" }),
  slot({ eventId: "n-se", level: "secondary", entries: 5 }),
  slot({
    eventId: "f-ee",
    typeId: "feature",
    typeNameEn: "Feature Writing",
    typeNameFil: "Pagsulat ng Lathalain",
    sortOrder: 4,
  }),
  slot({
    eventId: "m-se",
    typeId: "mojo",
    typeNameEn: "MOJO",
    typeNameFil: "MOJO",
    sortOrder: 10,
    level: "secondary",
  }),
  slot({
    eventId: "r-se",
    typeId: "radio",
    typeNameEn: "Radio Broadcasting and Scriptwriting (Regular)",
    typeNameFil: "Radio Broadcasting and Scriptwriting (Regular)",
    category: "group",
    minParticipants: 7,
    maxParticipants: 7,
    sortOrder: 11,
    level: "secondary",
  }),
]);

const names = (rows: { typeNameEn: string }[]) => rows.map((row) => row.typeNameEn);

describe("eventSearchQuery", () => {
  it("is null when the param is absent, empty or all spaces", () => {
    expect(eventSearchQuery({})).toBeNull();
    expect(eventSearchQuery({ q: "" })).toBeNull();
    expect(eventSearchQuery({ q: "   " })).toBeNull();
  });

  it("trims what it returns, so the message quotes the tidy form", () => {
    expect(eventSearchQuery({ q: "  news " })).toBe("news");
  });

  it("takes the first of a repeated param, as the search box does", () => {
    expect(eventSearchQuery({ q: ["news", "sports"] })).toBe("news");
  });

  it("survives an empty repeated param rather than throwing", () => {
    // Reaching `.trim()` on the array would be a 500 off a hand-edited URL.
    expect(eventSearchQuery({ q: [] })).toBeNull();
  });
});

describe("filterEventRows", () => {
  it("returns every row when nothing is set", () => {
    expect(names(filterEventRows(matrix.individual, {}))).toEqual([
      "News Writing",
      "Feature Writing",
      "MOJO",
    ]);
  });

  it("keeps sort_order rather than re-sorting", () => {
    // The wizard and the catalog list types in this sequence; filtering must not
    // become a second ordering of the same rows.
    expect(names(filterEventRows(matrix.individual, { q: "writing" }))).toEqual([
      "News Writing",
      "Feature Writing",
    ]);
  });

  it("matches the English name, case- and whitespace-insensitively", () => {
    expect(names(filterEventRows(matrix.individual, { q: " NEWS " }))).toEqual([
      "News Writing",
    ]);
  });

  it("matches the Filipino name printed under it", () => {
    // The second line is on screen, so a reader typing off it must find the row.
    expect(names(filterEventRows(matrix.individual, { q: "lathalain" }))).toEqual([
      "Feature Writing",
    ]);
  });

  it("matches a type whose two names are identical", () => {
    // MOJO and every group contest carry the same label in both fields.
    expect(names(filterEventRows(matrix.individual, { q: "mojo" }))).toEqual(["MOJO"]);
  });

  it("narrows the two sections independently", () => {
    // "news" legitimately empties Group while filling Individual, which is why the
    // page filters each table and asks for an empty state per section.
    expect(names(filterEventRows(matrix.group, { q: "news" }))).toEqual([]);
    expect(names(filterEventRows(matrix.group, { q: "radio" }))).toEqual([
      "Radio Broadcasting and Scriptwriting (Regular)",
    ]);
  });

  it("does not match the category, which is the card heading and not a cell", () => {
    // Typing "group" would empty Individual under its own heading rather than
    // narrow anything — navigation dressed up as a filter.
    expect(filterEventRows(matrix.individual, { q: "individual" })).toEqual([]);
    expect(filterEventRows(matrix.group, { q: "group" })).toEqual([]);
  });

  it("does not match the level or language, which are column headers", () => {
    expect(filterEventRows(matrix.individual, { q: "elementary" })).toEqual([]);
    expect(filterEventRows(matrix.individual, { q: "filipino" })).toEqual([]);
  });

  it("does not match the team size or the entry counts", () => {
    // The group row's team size cell prints "7" and News Writing carries 5
    // entries. Matching numbers would sweep in rows nobody was looking for.
    expect(filterEventRows(matrix.group, { q: "7" })).toEqual([]);
    expect(filterEventRows(matrix.individual, { q: "5" })).toEqual([]);
  });

  it("returns nothing for a query no type matches", () => {
    // The one filter on this page whose empty answer is the true answer.
    expect(filterEventRows(matrix.individual, { q: "qwerty" })).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(filterEventRows(matrix.individual, { q: "   " })).toHaveLength(3);
  });

  it("returns nothing from an empty section without throwing", () => {
    expect(filterEventRows([], { q: "news" })).toEqual([]);
  });
});

describe("eventEmptyState", () => {
  it("names the section rather than the catalogue when nothing is typed", () => {
    expect(eventEmptyState({}, "individual")).toEqual({
      message: "No individual contest is in the catalogue.",
      narrowed: false,
    });
    expect(eventEmptyState({}, "group")).toEqual({
      message: "No group contest is in the catalogue.",
      narrowed: false,
    });
  });

  it("quotes the query back per section and offers a way out", () => {
    expect(eventEmptyState({ q: "qwerty" }, "individual")).toEqual({
      message: "No individual contest matches “qwerty”.",
      narrowed: true,
    });
    expect(eventEmptyState({ q: "qwerty" }, "group")).toEqual({
      message: "No group contest matches “qwerty”.",
      narrowed: true,
    });
  });

  it("quotes the trimmed query, matching what the URL carries", () => {
    expect(eventEmptyState({ q: "  qwerty  " }, "group").message).toBe(
      "No group contest matches “qwerty”."
    );
  });

  it("is narrowed off the control, not off the row count", () => {
    // A query matching every type in a section still owes the reader the way back.
    expect(eventEmptyState({ q: "writing" }, "individual").narrowed).toBe(true);
  });
});

describe("eventTypeCountLabel", () => {
  it("pluralises, so a single searched row does not read as 1 types", () => {
    expect(eventTypeCountLabel(0)).toBe("0 types");
    expect(eventTypeCountLabel(1)).toBe("1 type");
    expect(eventTypeCountLabel(10)).toBe("10 types");
  });
});

describe("eventsExportFilename", () => {
  const date = "2026-08-23";

  it("names each card's download by its own category when nothing is searched", () => {
    expect(eventsExportFilename("individual", {}, date)).toBe(
      "press-link-events-individual-2026-08-23.xlsx"
    );
    expect(eventsExportFilename("group", {}, date)).toBe(
      "press-link-events-group-2026-08-23.xlsx"
    );
    // A blank query is no search, the same rule the URL and the box apply.
    expect(eventsExportFilename("individual", { q: "  " }, date)).toBe(
      "press-link-events-individual-2026-08-23.xlsx"
    );
  });

  it("marks a searched workbook, so it is not forwarded as the whole category", () => {
    expect(eventsExportFilename("individual", { q: "Feature Writing" }, date)).toBe(
      "press-link-events-individual-filtered-feature-writing-2026-08-23.xlsx"
    );
    expect(eventsExportFilename("group", { q: "Radio" }, date)).toBe(
      "press-link-events-group-filtered-radio-2026-08-23.xlsx"
    );
  });

  it("strips anything that could break out of the Content-Disposition header", () => {
    expect(eventsExportFilename("individual", { q: 'a"\r\nX-Evil: 1' }, date)).toBe(
      "press-link-events-individual-filtered-a-x-evil-1-2026-08-23.xlsx"
    );
  });

  it("still says filtered when the query slugs away to nothing", () => {
    expect(eventsExportFilename("group", { q: "!!!" }, date)).toBe(
      "press-link-events-group-filtered-search-2026-08-23.xlsx"
    );
    expect(eventsExportFilename("individual", { q: "ñ" }, date)).toBe(
      "press-link-events-individual-filtered-search-2026-08-23.xlsx"
    );
  });

  it("truncates a pasted query and never ends the slug on a dash", () => {
    expect(
      eventsExportFilename("individual", { q: "abcdefghijklmnopqrstuvw x" }, date)
    ).toBe("press-link-events-individual-filtered-abcdefghijklmnopqrstuvw-2026-08-23.xlsx");
  });
});
