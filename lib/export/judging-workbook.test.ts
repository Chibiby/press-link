import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  buildEventIndex,
  type EventJudgingFacts,
  type RawIndexEvent,
} from "@/lib/judging/event-index";
import type { ContestUnit, JudgeRank } from "@/lib/judging/types";

import {
  buildJudgesWorkbook,
  buildTabulatorsWorkbook,
  PANEL_HEADER,
  TABULATION_HEADER,
  toPanelRows,
  toTabulationRows,
  XL_CUT_NOT_SET,
  XL_NO_JUDGES,
  XL_NO_PANEL,
  XL_NO_QUALIFIERS,
  XL_NO_RESULTS,
  XL_NO_UNITS,
} from "./judging-workbook";

const AT = "2026-08-22";

function event(eventId: string, overrides: Partial<RawIndexEvent> = {}): RawIndexEvent {
  return {
    eventId,
    typeNameEn: "News Writing",
    typeNameFil: "Pagsulat ng Balita",
    category: "individual",
    level: "elementary",
    language: "english",
    sortOrder: 1,
    entries: 0,
    ...overrides,
  };
}

function unit(code: string, key = `u-${code}`): ContestUnit {
  return { unitKey: key, code, entryId: `e-${code}`, participantId: key };
}

function sheet(judgeId: string, places: Record<string, number>): JudgeRank[] {
  return Object.entries(places).map(([unitKey, rank]) => ({ judgeId, unitKey, rank }));
}

function facts(overrides: Partial<EventJudgingFacts> = {}): EventJudgingFacts {
  return {
    judgeIds: [],
    units: [],
    round1Ranks: [],
    round2Units: [],
    round2Ranks: [],
    rounds: { round1ClosedAt: null, round2CutUsed: null, resultsLockedAt: null },
    round2Cut: null,
    ...overrides,
  };
}

const A = unit("0001", "a");
const B = unit("0002", "b");

/** The state both pages are in today: real events, no judging schema behind them. */
const PREVIEW = buildEventIndex([
  event("e1", { entries: 4 }),
  event("e2", {
    sortOrder: 2,
    typeNameEn: "Editorial Writing",
    typeNameFil: "Pagsulat ng Editoryal",
    entries: 6,
  }),
]);

describe("toPanelRows on the state the page is actually in", () => {
  const rows = toPanelRows(PREVIEW);
  const first = rows[0];

  it("never prints a structural absence as a zero", () => {
    // The whole reason this module exists. A spreadsheet has no tooltip to hold the
    // reason in, so the reason is the value.
    expect(first.Panel).toBe(XL_NO_PANEL);
    expect(first["Round 1"]).toBe(XL_NO_PANEL);
    expect(first["Round 2"]).toBe(XL_NO_PANEL);
    expect(first.Panel).not.toBe(0);
  });

  it("leaves the round-2 cut unset rather than showing the default of 10", () => {
    expect(first["R2 cut"]).toBe(XL_CUT_NOT_SET);
    expect(rows.some((row) => row["R2 cut"] === 10)).toBe(false);
  });

  it("keeps the entry count a number, because that one is measured", () => {
    // Entries are real today. Wording them as absent would be the opposite error.
    expect(first.Entries).toBe(4);
  });

  it("takes its status wording from the state machine, not from a literal", () => {
    expect(first.Status).toBe("Not started");
    expect(first.Why).toBe("No judge is assigned to this event yet.");
  });

  it("lists events in the catalog order the index established", () => {
    expect(rows.slice(0, 2).map((row) => row.Event)).toEqual([
      "News Writing",
      "Editorial Writing",
    ]);
  });

  it("carries the Filipino name and the slot label from the row", () => {
    expect(first["Filipino name"]).toBe("Pagsulat ng Balita");
    expect(first["Level · Language"]).toBe("Elem · Eng");
  });

  it("capitalises the category, which only CSS does on screen", () => {
    // The badge on the page carries `capitalize`; a cell has no stylesheet, so a raw
    // "individual" would be the only lowercased word in the sheet.
    expect(first.Category).toBe("Individual");
    expect(
      toPanelRows(buildEventIndex([event("g", { category: "group" })]))[0].Category
    ).toBe("Group");
  });

  it("blanks the Filipino name when it would only repeat the English one", () => {
    const [only] = toPanelRows(
      buildEventIndex([
        event("e1", { typeNameEn: "Radio Broadcasting", typeNameFil: "Radio Broadcasting" }),
      ])
    );
    expect(only["Filipino name"]).toBe("");
  });
});

describe("the panel total row", () => {
  const total = toPanelRows(PREVIEW).at(-1);

  it("sums the entries", () => {
    expect(total?.Event).toBe("ALL EVENTS");
    expect(total?.Entries).toBe(10);
  });

  it("counts events with a panel instead of totalling seats", () => {
    // Summing seats would read as a headcount of judges, and one judge sits on
    // several panels, so the sum would overstate the roster.
    expect(total?.Panel).toBe("0 of 2 events have a panel");
  });

  it("is dropped entirely when there are no events to total", () => {
    expect(toPanelRows([])).toEqual([]);
    expect(toTabulationRows([])).toEqual([]);
  });
});

describe("toPanelRows once a panel is seated", () => {
  // Proves the progress cells are computed and not hardcoded absences: the same
  // builder, given facts, reports figures.
  const rows = toPanelRows(
    buildEventIndex([event("e1", { entries: 2 })], {
      e1: facts({
        judgeIds: ["j1", "j2"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round2Cut: 8,
      }),
    })
  );

  it("reports the seat count as a number", () => {
    expect(rows[0].Panel).toBe(2);
  });

  it("quotes round 1's progress the way the table does", () => {
    expect(rows[0]["Round 1"]).toBe("2 / 4 ranks (1/2 judges)");
  });

  it("prints a cut that was actually chosen", () => {
    expect(rows[0]["R2 cut"]).toBe(8);
  });

  it("still explains round 2, which has no units drawn yet", () => {
    expect(rows[0]["Round 2"]).toBe(XL_NO_UNITS);
  });

  it("follows the state machine into round 1 open", () => {
    expect(rows[0].Status).toBe("Round 1 open");
  });
});

describe("toTabulationRows", () => {
  const rows = toTabulationRows(PREVIEW);

  it("explains the missing qualifier and result counts", () => {
    expect(rows[0].Qualifiers).toBe(XL_NO_QUALIFIERS);
    expect(rows[0].Placed).toBe(XL_NO_RESULTS);
  });

  it("shares the status wording with the judges sheet", () => {
    // Both pages read the same row, so a divergence here would mean one of the two
    // workbooks had started deriving status for itself.
    expect(rows[0].Status).toBe(toPanelRows(PREVIEW)[0].Status);
  });

  it("totals the entries and counts published sheets", () => {
    const total = rows.at(-1);
    expect(total?.Entries).toBe(10);
    expect(total?.Status).toBe("0 of 2 sheets published");
  });
});

describe("buildJudgesWorkbook", () => {
  const book = buildJudgesWorkbook(PREVIEW, AT);

  it("leads with the disclosure, before any figure", () => {
    expect(book.SheetNames).toEqual([
      "About this export",
      "Panels by event",
      "Judges on file",
    ]);
  });

  it("says on the About sheet that migration 0018 has not run", () => {
    const text = XLSX.utils.sheet_to_csv(book.Sheets["About this export"]);
    expect(text).toContain("Migration 0018 has not run");
    expect(text).toContain(AT);
  });

  it("keeps the roster sheet and explains why it has no judges", () => {
    // Dropping the sheet would leave a reader to conclude the roster was never part
    // of this, which is the opposite of the truth.
    const text = XLSX.utils.sheet_to_csv(book.Sheets["Judges on file"]);
    expect(text).toContain(XL_NO_JUDGES);
  });

  it("heads the panel sheet with every column, in order", () => {
    const grid = XLSX.utils.sheet_to_json<string[]>(book.Sheets["Panels by event"], {
      header: 1,
    });
    expect(grid[0]).toEqual([...PANEL_HEADER]);
  });

  it("writes a real xlsx file", () => {
    // A workbook that cannot be serialised is not an export. PK is the zip magic
    // every .xlsx begins with.
    const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

describe("buildTabulatorsWorkbook", () => {
  const book = buildTabulatorsWorkbook(PREVIEW, AT);

  it("leads with the same disclosure and names its own page", () => {
    expect(book.SheetNames).toEqual(["About this export", "Sheets by event"]);
    const text = XLSX.utils.sheet_to_csv(book.Sheets["About this export"]);
    expect(text).toContain("/admin/tabulators");
  });

  it("heads the tabulation sheet with every column, in order", () => {
    const grid = XLSX.utils.sheet_to_json<string[]>(book.Sheets["Sheets by event"], {
      header: 1,
    });
    expect(grid[0]).toEqual([...TABULATION_HEADER]);
  });

  it("writes a real xlsx file", () => {
    const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
