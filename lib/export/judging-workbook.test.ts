import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { CellValue } from "exceljs";

import {
  buildEventIndex,
  type EventIndexRow,
  type EventJudgingFacts,
  type RawIndexEvent,
} from "@/lib/judging/event-index";
import { TABULATION_COLUMNS } from "@/lib/judging/tabulation";
import type { ContestUnit, JudgeRank, TabulationRow as SheetRow } from "@/lib/judging/types";

import {
  buildEventSheetWorkbook,
  buildJudgesWorkbook,
  buildTabulatorsWorkbook,
  PANEL_HEADER,
  ROSTER_HEADER,
  TABULATION_HEADER,
  toPanelRows,
  toRosterRows,
  toTabulationRows,
  type JudgeRosterExportRow,
  XL_CUT_NOT_SET,
  XL_NO_JUDGES,
  XL_NO_PANEL,
  XL_NO_UNITS,
} from "./judging-workbook";

const HEADER_ROW = 1;

function sheetText(sheet: ExcelJS.Worksheet): string {
  const lines: string[] = [];
  sheet.eachRow((row) => {
    lines.push(
      (row.values as CellValue[])
        .slice(1)
        .map((v) => (v ?? "").toString())
        .join(",")
    );
  });
  return lines.join("\n");
}

function rowValues(sheet: ExcelJS.Worksheet, rowNumber: number): CellValue[] {
  return (sheet.getRow(rowNumber).values as CellValue[]).slice(1);
}

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

/**
 * Nothing judged, but a cut on file — which is what an untouched event looks like
 * now that `events.round2_cut` exists and is `not null default 30`.
 */
function facts(overrides: Partial<EventJudgingFacts> = {}): EventJudgingFacts {
  const judgeIds = overrides.judgeIds ?? [];
  return {
    judgeIds,
    // Seat order, so the first judge holds seat 1 and ranks round 1 alone (N1).
    round1JudgeId: judgeIds[0] ?? null,
    round1SubmittedAt: null,
    units: [],
    round1Ranks: [],
    round2Units: [],
    round2Ranks: [],
    rounds: { round1ClosedAt: null, round1LockedAt: null, round2CutUsed: null, resultsLockedAt: null },
    round2Cut: 10,
    ...overrides,
  };
}

const A = unit("0001", "a");
const B = unit("0002", "b");

/**
 * Two real events with the judging tables present and empty: no judge assigned, no
 * rank cast, a cut of 10 on file. Every judging figure off this fixture is a
 * measured nought, which is what most of the division looks like today.
 */
const UNJUDGED = buildEventIndex(
  [
    event("e1", { entries: 4 }),
    event("e2", {
      sortOrder: 2,
      typeNameEn: "Editorial Writing",
      typeNameFil: "Pagsulat ng Editoryal",
      entries: 6,
    }),
  ],
  { e1: facts(), e2: facts() }
);

/** The one absence left: a cut that could not be read. */
const NO_CUT: EventIndexRow[] = buildEventIndex([event("e1", { entries: 4 })], {
  e1: facts({ round2Cut: null }),
});

const ROSTER: JudgeRosterExportRow[] = [
  {
    name: "Dela Cruz, Maria L.",
    affiliation: "Sarangani NHS",
    email: "maria@example.gov.ph",
    events: 3,
    isActive: true,
  },
  { name: "Reyes, Juan", affiliation: null, email: null, events: 0, isActive: false },
];

describe("toPanelRows on an event nobody has begun judging", () => {
  const rows = toPanelRows(UNJUDGED);
  const first = rows[0];

  it("says no panel is seated rather than printing a bare 0", () => {
    // The whole reason this module exists. A spreadsheet has no tooltip to hold the
    // reason in, so the reason is the value — and with no panel there is no
    // denominator, so the round cells have nothing to be a fraction of.
    expect(first.Panel).toBe(XL_NO_PANEL);
    expect(first["Round 1"]).toBe(XL_NO_PANEL);
    expect(first["Round 2"]).toBe(XL_NO_PANEL);
    expect(first.Panel).not.toBe(0);
  });

  it("prints the cut that is on file, default or not", () => {
    // 10 is the division's default, but it is now a value in the column rather than
    // an assumption — so printing it reports what the event is set to.
    expect(first["R2 cut"]).toBe(10);
  });

  it("never substitutes 10 for a cut it could not read", () => {
    const [unread] = toPanelRows(NO_CUT);
    expect(unread["R2 cut"]).toBe(XL_CUT_NOT_SET);
    expect(unread["R2 cut"]).not.toBe(10);
  });

  it("keeps the entry count a number, because that one is measured", () => {
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
  const total = toPanelRows(UNJUDGED).at(-1);

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
  const rows = toTabulationRows(UNJUDGED);

  it("reports measured noughts as noughts, not as sentences", () => {
    // With the cut on file and the boards read and found empty, both of these are
    // answers to a query. Wording them as absent would be the mirror-image lie.
    expect(rows[0].Qualifiers).toBe(0);
    expect(rows[0].Placed).toBe(0);
  });

  it("holds the reason where a cut could not be read", () => {
    // No cut means no field to divide, so no standings were computed at all — the
    // one case where Placed is genuinely unavailable rather than nought.
    const [unread] = toTabulationRows(NO_CUT);
    expect(unread.Placed).toBe(XL_CUT_NOT_SET);
    expect(unread.Qualifiers).toBe(0);
  });

  it("counts qualifiers off the round-2 board and placements off the standings", () => {
    const [judged] = toTabulationRows(
      buildEventIndex([event("e1", { entries: 2 })], {
        e1: facts({
          judgeIds: ["j1", "j2"],
          units: [A, B],
          round1Ranks: sheet("j1", { a: 1, b: 2 }),
          round2Units: [A],
          // j2, not j1: seat 1 cuts the field and does not also place it (N1).
          round2Ranks: sheet("j2", { a: 1 }),
          round2Cut: 1,
          rounds: {
            round1ClosedAt: "2026-08-01T00:00:00Z",
            round1LockedAt: "2026-08-01T00:00:00Z",
            round2CutUsed: 1,
            resultsLockedAt: null,
          },
        }),
      })
    );
    expect(judged.Qualifiers).toBe(1);
    // One placement, not two: under N4 the unit below the cut was eliminated in
    // round 1 and has no final rank, so only the qualifier round 2 ranked is
    // placed.
    expect(judged.Placed).toBe(1);
  });

  it("shares the status wording with the judges sheet", () => {
    // Both pages read the same row, so a divergence here would mean one of the two
    // workbooks had started deriving status for itself.
    expect(rows[0].Status).toBe(toPanelRows(UNJUDGED)[0].Status);
  });

  it("totals the entries and counts published sheets", () => {
    const total = rows.at(-1);
    expect(total?.Entries).toBe(10);
    expect(total?.Placed).toBe(0);
    expect(total?.Status).toBe("0 of 2 sheets published");
  });

  it("names the events it could not count instead of folding them in as noughts", () => {
    // A plain sum would report fewer placements than the division has made and give
    // no sign that an event was left out of it.
    const total = toTabulationRows([...UNJUDGED, ...NO_CUT]).at(-1);
    expect(total?.Placed).toBe("0 — not counting 1 event with no cut on file");
  });
});

describe("toRosterRows", () => {
  const rows = toRosterRows(ROSTER);

  it("prints every judge on file, in the order the roster gave them", () => {
    expect(rows.map((row) => row.Judge)).toEqual(["Dela Cruz, Maria L.", "Reyes, Juan"]);
  });

  it("keeps the event count a number, because it is counted", () => {
    // 0 here means this judge sits on no panel — a measurement, not an absence.
    expect(rows[0].Events).toBe(3);
    expect(rows[1].Events).toBe(0);
  });

  it("blanks an affiliation or email nobody supplied rather than inventing one", () => {
    expect(rows[1].Affiliation).toBe("");
    expect(rows[1].Email).toBe("");
  });

  it("spells the active flag out, since a bare boolean means nothing in a cell", () => {
    expect(rows[0].Status).toBe("Active");
    expect(rows[1].Status).toBe("Inactive");
  });
});

describe("buildJudgesWorkbook", () => {
  const book = buildJudgesWorkbook({ rows: UNJUDGED, judges: ROSTER }, AT);

  it("leads with the reading guide, before any figure", () => {
    expect(book.worksheets.map((s) => s.name)).toEqual([
      "About this export",
      "Panels by event",
      "Judges on file",
    ]);
  });

  it("says on the About sheet how to tell a nought from an absence", () => {
    const text = sheetText(book.getWorksheet("About this export")!);
    expect(text).toContain("A 0 was measured");
    expect(text).toContain(AT);
  });

  it("no longer claims the judging tables are absent", () => {
    // They are in the database now. Saying otherwise would make every measured
    // figure in the file unreadable, which is the failure this sheet exists against.
    const text = sheetText(book.getWorksheet("About this export")!);
    expect(text).not.toContain("Migration 0018");
    expect(text).not.toContain("layout preview");
  });

  it("heads the roster sheet with every column, in order", () => {
    const sheet = book.getWorksheet("Judges on file")!;
    expect(rowValues(sheet, HEADER_ROW)).toEqual([...ROSTER_HEADER]);
    expect(rowValues(sheet, HEADER_ROW + 1)[0]).toBe("Dela Cruz, Maria L.");
  });

  it("keeps the roster sheet and explains an empty roster in it", () => {
    // Dropping the sheet would leave a reader to conclude the roster was never part
    // of this export, which is the opposite of the truth.
    const empty = buildJudgesWorkbook({ rows: UNJUDGED, judges: [] }, AT);
    const sheet = empty.getWorksheet("Judges on file");
    expect(sheet).toBeDefined();
    expect(sheetText(sheet!)).toContain(XL_NO_JUDGES);
  });

  it("heads the panel sheet with every column, in order", () => {
    const sheet = book.getWorksheet("Panels by event")!;
    expect(rowValues(sheet, HEADER_ROW)).toEqual([...PANEL_HEADER]);
  });

  it("writes a real xlsx file", async () => {
    // A workbook that cannot be serialised is not an export. PK is the zip magic
    // every .xlsx begins with.
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

describe("buildTabulatorsWorkbook", () => {
  const book = buildTabulatorsWorkbook({ rows: UNJUDGED, judges: ROSTER }, AT);

  it("leads with the same reading guide and names its own page", () => {
    expect(book.worksheets.map((s) => s.name)).toEqual([
      "About this export",
      "Sheets by event",
    ]);
    const text = sheetText(book.getWorksheet("About this export")!);
    expect(text).toContain("/admin/tabulators");
  });

  it("leaves the roster out, because a tabulator's sheet never names a judge", () => {
    // Round-2 qualification and the standings are anonymous work. A roster in this
    // file would put judges and contest codes in one workbook for no reason.
    expect(book.worksheets.map((s) => s.name)).not.toContain("Judges on file");
  });

  it("heads the tabulation sheet with every column, in order", () => {
    const sheet = book.getWorksheet("Sheets by event")!;
    expect(rowValues(sheet, HEADER_ROW)).toEqual([...TABULATION_HEADER]);
  });

  it("writes a real xlsx file", async () => {
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

/**
 * One event's sheet, as the tabulators' page has it: two qualifiers placed and one
 * contestant eliminated in round 1, who therefore has no round-2 figures and no
 * final placement at all (N4).
 */
function sheetRow(code: string, overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    unitKey: `u-${code}`,
    code,
    entryId: `e-${code}`,
    participantId: `u-${code}`,
    qualified: true,
    round1Points: 1,
    round1Rank: 1,
    round2Points: 6,
    round2Rank: 1,
    finalPoints: 7,
    finalRank: 1,
    name: "Dela Cruz, Maria L.",
    coaches: ["Reyes, Juan", "Santos, Ana"],
    schoolPaper: "The Torch",
    schoolName: "Sarangani NHS",
    districtName: "Alabel",
    ...overrides,
  };
}

const EVENT_ROWS: SheetRow[] = [
  sheetRow("0001"),
  sheetRow("0002", { round1Rank: 2, round1Points: 2, round2Points: 8, round2Rank: 2, finalPoints: 10, finalRank: 2 }),
  sheetRow("0003", {
    qualified: false,
    round1Points: null,
    round1Rank: null,
    round2Points: null,
    round2Rank: null,
    finalPoints: null,
    finalRank: null,
  }),
];

describe("buildEventSheetWorkbook", () => {
  const row = UNJUDGED[0];
  const book = buildEventSheetWorkbook({ row, rows: EVENT_ROWS, unidentified: [] }, AT);

  it("names the event before any figure, because a results sheet gets printed", () => {
    expect(book.worksheets.map((s) => s.name)).toEqual(["About this export", "Results sheet"]);
    const text = sheetText(book.getWorksheet("About this export")!);
    expect(text).toContain(row.typeNameEn);
    expect(text).toContain(row.slotLabel);
    expect(text).toContain(AT);
    expect(text).toContain(`/admin/tabulators/${row.eventId}`);
  });

  it("heads the sheet with the page's own columns, in the page's own order", () => {
    // The guarantee TABULATION_COLUMNS exists for: the file a tabulator downloads
    // must not have different columns in a different order from the screen it came
    // from. A literal header in the builder is how that would come apart.
    const sheet = book.getWorksheet("Results sheet")!;
    expect(rowValues(sheet, HEADER_ROW)).toEqual(TABULATION_COLUMNS.map((c) => c.label));
  });

  it("writes a rank as a number, so the sheet can be sorted on it", () => {
    const sheet = book.getWorksheet("Results sheet")!;
    const first = rowValues(sheet, HEADER_ROW + 1);
    expect(first[0]).toBe("0001");
    expect(first[TABULATION_COLUMNS.findIndex((c) => c.key === "finalRank")]).toBe(1);
  });

  it("leaves out a contestant the judge left blank", () => {
    // Under N2 a blank is not an unanswered row, it is a decision: they were seen
    // and not placed. They carry no figure on this sheet at all.
    const sheet = book.getWorksheet("Results sheet")!;
    expect(rowValues(sheet, HEADER_ROW + 1)[0]).toBe("0001");
    expect(rowValues(sheet, HEADER_ROW + 2)[0]).toBe("0002");
    expect(rowValues(sheet, HEADER_ROW + 3)).toEqual([]);
    expect(sheetText(sheet)).not.toContain("0003");
  });

  it("keeps a contestant the judge ranked past the cut", () => {
    // The regression this guards: the file listed the qualifier list alone, which
    // dropped somebody ranked 16th under a cut of 15 — placed by the judge, absent
    // from the file, and nothing on either to say why.
    const beyondCut = buildEventSheetWorkbook(
      {
        row,
        rows: [
          sheetRow("0001"),
          sheetRow("0016", {
            qualified: false,
            round1Rank: 16,
            round1Points: 16,
            round2Points: null,
            round2Rank: null,
            finalPoints: null,
            finalRank: null,
          }),
        ],
        unidentified: [],
      },
      AT
    );
    const sheet = beyondCut.getWorksheet("Results sheet")!;
    const row16 = rowValues(sheet, HEADER_ROW + 2);
    expect(row16[0]).toBe("0016");
    expect(row16[TABULATION_COLUMNS.findIndex((c) => c.key === "round1Rank")]).toBe(16);
    // Ranked, not qualified: the round 2 columns are an absence, not a nought.
    expect(row16[TABULATION_COLUMNS.findIndex((c) => c.key === "round2Points")]).toBe("—");
    expect(sheetText(beyondCut.getWorksheet("About this export")!)).toContain(
      "ranked past the cut"
    );
  });

  it("prints an absent placement as an em dash, never as a nought", () => {
    // 0 would sort as a winning place. A qualifier whose round 2 is still being
    // judged has no placement yet, and that is an absence rather than a score.
    const midRound2 = buildEventSheetWorkbook(
      {
        row,
        rows: [sheetRow("0001", { round2Points: null, round2Rank: null, finalPoints: null, finalRank: null })],
        unidentified: [],
      },
      AT
    );
    const cells = rowValues(midRound2.getWorksheet("Results sheet")!, HEADER_ROW + 1);
    expect(cells[TABULATION_COLUMNS.findIndex((c) => c.key === "finalRank")]).toBe("—");
    expect(cells[TABULATION_COLUMNS.findIndex((c) => c.key === "round2Points")]).toBe("—");
  });

  it("says which absence it is when nobody has been ranked", () => {
    // Not an empty table: an unranked field is a judge who has not filed, which is a
    // different fact from an event nobody entered, and a spreadsheet carries no
    // tooltip to tell them apart later.
    const none = buildEventSheetWorkbook(
      {
        row,
        rows: [sheetRow("0001", { qualified: false, round1Rank: null, round1Points: null })],
        unidentified: [],
      },
      AT
    );
    const text = sheetText(none.getWorksheet("Results sheet")!);
    expect(text).toContain("No contestant has been ranked");
    expect(text).toContain("1 contestant is");
  });

  it("counts the three groups against each other on the About sheet", () => {
    // Entered, placed, through. A reader who added up the rows and got a different
    // number from "Contestants" would otherwise be right to wonder which was wrong.
    const text = sheetText(book.getWorksheet("About this export")!);
    expect(text).toContain("What this sheet lists");
    expect(text).toContain("Every contestant the round 1 judge placed");
    expect(text).toContain("Contestants,3");
  });

  it("joins coaches with semicolons, since a name may carry a comma", () => {
    const sheet = book.getWorksheet("Results sheet")!;
    expect(rowValues(sheet, HEADER_ROW + 1)[TABULATION_COLUMNS.findIndex((c) => c.key === "coach")]).toBe(
      "Reyes, Juan; Santos, Ana"
    );
  });

  it("names the codes it could not identify, rather than leaving them to be noticed", () => {
    const flawed = buildEventSheetWorkbook(
      { row, rows: EVENT_ROWS, unidentified: ["0007"] },
      AT
    );
    expect(sheetText(flawed.getWorksheet("About this export")!)).toContain("0007");
  });

  it("keeps the sheet and explains an empty one, worded for which absence it is", () => {
    // Dropping the sheet would read as an export that never covered this event.
    const noCut = buildEventSheetWorkbook({ row: NO_CUT[0], rows: [], unidentified: [] }, AT);
    expect(sheetText(noCut.getWorksheet("Results sheet")!)).toContain(XL_CUT_NOT_SET);

    const empty = buildEventSheetWorkbook({ row, rows: [], unidentified: [] }, AT);
    expect(sheetText(empty.getWorksheet("Results sheet")!)).toContain("no contestants on file");
  });

  it("writes a real xlsx file", async () => {
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
