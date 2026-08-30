import ExcelJS from "exceljs";

import type { EventCategory } from "@/lib/events-catalog";
import { boardProgress } from "@/lib/judging/consolidate";
import { eventIndexSummary, type EventIndexRow } from "@/lib/judging/event-index";
import { EVENT_JUDGING_LABEL } from "@/lib/judging/sheet-state";
import {
  TABULATION_COLUMNS,
  tabulationCell,
  tabulationSummary,
} from "@/lib/judging/tabulation";
import type { TabulationRow as SheetRow } from "@/lib/judging/types";

import { borderRow } from "./borders";

/**
 * The workbooks behind the export buttons on /admin/judges and /admin/tabulators.
 *
 * Both are built from the same `EventIndexRow[]` the two pages render, so a
 * downloaded file and the screen it came from cannot disagree — the reason
 * `overall-data-workbook.ts` is shaped this way too.
 *
 * ## Why the cells carry sentences and not just figures
 *
 * On screen an absent figure is a `NotYetCell`: an em dash with the reason in a
 * tooltip. A spreadsheet has no tooltip, and a downloaded file outlives the page
 * that made it — it gets mailed on, opened next month, and read by someone with no
 * way left to ask what a blank meant. A bare 0 in a Panel column would be read as
 * "nobody was assigned", which is a measurement.
 *
 * Every figure in these workbooks is now measured, so most of those sentences have
 * gone: an empty roster is an empty roster and 0 qualifiers means none were drawn.
 * What is left are the genuine absences — no panel seated, no entries to rank, no
 * cut on file — and each still holds its reason as its cell value, with the first
 * sheet of each workbook saying how to read one. A structural absence must never be
 * printed as a measured zero.
 */

/**
 * The wordings for an absence.
 *
 * These are the workbook's copies of the four sentences in
 * `components/admin/judging/empty-states`, which is where the screen keeps them.
 * Copied rather than imported because this module is pure and `lib/` does not import
 * from `components/` — the import would invert the layering even though that file
 * happens to hold no React.
 *
 * Each one opens with the screen's sentence verbatim. Two of them then add what a
 * spreadsheet needs and a tooltip does not: an unread cut and an empty roster both
 * land where a number belongs, so each rules out being read as a nought. The other
 * two already name the absence and say why there is no figure, so they travel
 * unchanged.
 *
 * If a wording changes on screen it has to change here too, and
 * `empty-states.test.ts` pins each pair — from the components side, which may import
 * this module — so a drift fails the suite instead of shipping a workbook that words
 * an absence differently from the page.
 *
 * Two earlier constants have gone rather than been reworded. `XL_NO_QUALIFIERS` and
 * `XL_NO_RESULTS` each said a table arrives with migration 0018; the tables are
 * there, both columns are read, and a sentence in place of the number they now hold
 * would be the lie in the other direction.
 */
export const XL_NO_PANEL = "No panel is seated, so there are no ranks to count.";
export const XL_NO_UNITS = "This event has no entries, so there is nothing to rank.";
export const XL_CUT_NOT_SET =
  "No round-2 cut is on file for this event. This cell holds that reason, not a cut of nought — and not the division's usual default of 10, which nobody has chosen for this event.";
export const XL_NO_JUDGES =
  "No judge has been added yet. The roster is empty, so no panel can be seated. This is an empty table, read and found to hold nothing.";

/**
 * On screen the category rides in a badge carrying Tailwind's `capitalize`, so it
 * reads "Individual". A cell has no stylesheet, so the capital has to be in the
 * value — `lib/events-catalog` has no prose label to borrow.
 */
const CATEGORY_LABEL: Record<EventCategory, string> = {
  individual: "Individual",
  group: "Group",
};

/** A cell holds a number only when the figure is real. Otherwise it holds the reason. */
type Cell = number | string;

export const PANEL_HEADER = [
  "Event",
  "Filipino name",
  "Level · Language",
  "Category",
  "Entries",
  "Panel",
  "Round 1",
  "Round 2",
  "R2 cut",
  "Status",
  "Why",
] as const;

export const TABULATION_HEADER = [
  "Event",
  "Filipino name",
  "Level · Language",
  "Category",
  "Entries",
  "Qualifiers",
  "Placed",
  "Status",
  "Why",
] as const;

export const ROSTER_HEADER = ["Judge", "Affiliation", "Email", "Events", "Status"] as const;

export type PanelRow = Record<(typeof PANEL_HEADER)[number], Cell>;
export type TabulationRow = Record<(typeof TABULATION_HEADER)[number], Cell>;
export type RosterRow = Record<(typeof ROSTER_HEADER)[number], Cell>;

/**
 * One judge as the workbook prints them.
 *
 * A local shape rather than the pages' `JudgeRosterRow`, which is declared in a
 * component module: `lib/` does not import from `components/`, and this file stays
 * React-free. `JudgeRosterRow` is structurally assignable to this, so a route hands
 * its loaded roster straight over.
 *
 * Only these five fields. The roster table also carries `hasLogin`, and that is
 * deliberately not printed: whether an account has been made is a fact about this
 * console's own provisioning, not a fact about the contest, and `ROSTER_HEADER` is
 * the sheet a division circulates.
 */
export interface JudgeRosterExportRow {
  name: string;
  affiliation: string | null;
  email: string | null;
  events: number;
  isActive: boolean;
}

/**
 * What the two builders are given, which is what the two pages render.
 *
 * Declared here rather than imported from `app/admin/(shell)/judging-data.ts` for the
 * same layering reason: `lib/` does not import from `app/`. `JudgingEventIndex` is
 * structurally assignable to it, so the export routes pass their loaded index through
 * unchanged and neither builder issues a query of its own.
 */
export interface JudgingExportInput {
  rows: EventIndexRow[];
  judges: JudgeRosterExportRow[];
}

/**
 * The roster sheet's rows.
 *
 * An inactive judge is listed rather than filtered out: they may be on a panel from
 * an earlier round of the contest, and a roster that quietly dropped them would not
 * account for a rank already on file. The status column is what says which.
 */
export function toRosterRows(judges: JudgeRosterExportRow[]): RosterRow[] {
  return judges.map((judge) => ({
    Judge: judge.name,
    // A blank, not a sentence: nothing is on file, and "not recorded" in every row of
    // a column nobody filled in reads as a fault rather than as an optional field.
    Affiliation: judge.affiliation ?? "",
    Email: judge.email ?? "",
    Events: judge.events,
    Status: judge.isActive ? "Active" : "Inactive",
  }));
}

/**
 * How far a round has got, in the words the screen uses.
 *
 * Mirrors `RoundProgress` in `EventPanelTable` branch for branch — no panel,
 * then no units, then the figures — and calls the same `boardProgress`, so the
 * column cannot drift from the cell it is a copy of.
 */
function roundCell(board: EventIndexRow["round1"], panelSize: number): Cell {
  if (panelSize === 0) return XL_NO_PANEL;
  if (board.rows.length === 0) return XL_NO_UNITS;

  const progress = boardProgress(board);
  return `${progress.filled} / ${progress.expected} ranks (${progress.judgesDone}/${panelSize} judges)`;
}

/**
 * Left blank rather than repeated when the two names match — the same test the
 * tables make before printing a second line under the English one.
 */
function filipinoName(row: EventIndexRow): string {
  return row.typeNameFil === row.typeNameEn ? "" : row.typeNameFil;
}

/** One row per event, in the catalog order `buildEventIndex` already put them in. */
export function toPanelRows(rows: EventIndexRow[]): PanelRow[] {
  const out: PanelRow[] = rows.map((row) => ({
    Event: row.typeNameEn,
    "Filipino name": filipinoName(row),
    "Level · Language": row.slotLabel,
    Category: CATEGORY_LABEL[row.category],
    Entries: row.entries,
    Panel: row.panelSize === 0 ? XL_NO_PANEL : row.panelSize,
    "Round 1": roundCell(row.round1, row.panelSize),
    "Round 2": roundCell(row.round2, row.panelSize),
    // Never 10. `events.round2_cut` is `not null default 10`, so a null here is a
    // value that could not be read — and printing the default in its place would
    // report a decision nobody took for this event.
    "R2 cut": row.round2Cut === null ? XL_CUT_NOT_SET : row.round2Cut,
    Status: EVENT_JUDGING_LABEL[row.state.status],
    Why: row.state.reason,
  }));

  return out.length === 0 ? out : [...out, panelTotal(rows)];
}

/**
 * The division line under the events.
 *
 * Entries is a real sum. Panel is not: totalling seats across events would read
 * as a headcount of judges, and one judge sits on several panels, so that cell
 * counts events with a panel instead.
 */
function panelTotal(rows: EventIndexRow[]): PanelRow {
  const summary = eventIndexSummary(rows);

  return {
    Event: "ALL EVENTS",
    "Filipino name": "",
    "Level · Language": `${summary.events} events in the catalog`,
    Category: "",
    Entries: summary.entries,
    Panel: `${summary.withPanel} of ${summary.events} events have a panel`,
    "Round 1": `${summary.awaitingAction} awaiting an admin action`,
    "Round 2": `${summary.locked} locked`,
    "R2 cut": "",
    Status: `${summary.notStarted} not started`,
    Why: "",
  };
}

/** One row per event, for the tabulators' view of the same index. */
export function toTabulationRows(rows: EventIndexRow[]): TabulationRow[] {
  const out: TabulationRow[] = rows.map((row) => ({
    Event: row.typeNameEn,
    "Filipino name": filipinoName(row),
    "Level · Language": row.slotLabel,
    Category: CATEGORY_LABEL[row.category],
    Entries: row.entries,
    // Both are read, and both mirror the cell `TabulationIndexTable` renders.
    // Qualifiers is counted off the round-2 board, so 0 means none has been drawn;
    // Placed is null only when the cut behind it could not be read, which is the one
    // case that still holds a sentence.
    Qualifiers: row.round2.rows.length,
    Placed: row.placed === null ? XL_CUT_NOT_SET : row.placed,
    Status: EVENT_JUDGING_LABEL[row.state.status],
    Why: row.state.reason,
  }));

  if (out.length === 0) return out;

  const summary = eventIndexSummary(rows);
  return [
    ...out,
    {
      Event: "ALL EVENTS",
      "Filipino name": "",
      "Level · Language": `${summary.events} events in the catalog`,
      Category: "",
      Entries: summary.entries,
      Qualifiers: summary.qualifiers,
      // A sum of what was measured. Events with no cut on file are named rather than
      // folded in as noughts, which would put a smaller total here than the division
      // has placed and give no sign of why.
      Placed:
        summary.withoutCut === 0
          ? summary.placed
          : `${summary.placed} — not counting ${summary.withoutCut} ${
              summary.withoutCut === 1 ? "event" : "events"
            } with no cut on file`,
      Status: `${summary.locked} of ${summary.events} sheets published`,
      Why: "",
    },
  ];
}

/**
 * The sheet that says how to read the ones after it.
 *
 * A workbook travels: it arrives with no page around it, nothing to hover, and no
 * way left to ask what a cell meant. On screen that job is done by the sentence
 * under each figure and by `NotYetCell` in the columns; here it has to be written
 * down, and it goes first so a reader meets it before any number.
 *
 * It is no longer a preview disclosure. Every figure in this file is now the answer
 * to a query, and what this sheet explains is the one thing the cells cannot say
 * about themselves: which blanks and which sentences mean what.
 */
/**
 * Writes an array-of-arrays block starting at `startRow`. Returns the last row
 * written.
 */
function writeAoa(sheet: ExcelJS.Worksheet, aoa: (string | number)[][], startRow: number): number {
  aoa.forEach((line, i) => {
    sheet.getRow(startRow + i).values = line;
  });
  return startRow + aoa.length - 1;
}

/**
 * Writes a header row at `headerRowIndex` plus one row per record, bordering
 * both the header and every data row (totals included, since they arrive as
 * ordinary records in `records`). Returns the last row written.
 */
function writeTable<Header extends string>(
  sheet: ExcelJS.Worksheet,
  headers: readonly Header[],
  records: Record<Header, string | number>[],
  headerRowIndex: number
): number {
  sheet.getRow(headerRowIndex).values = [...headers];
  borderRow(sheet, headerRowIndex, headers.length);
  records.forEach((record, i) => {
    const rowIndex = headerRowIndex + 1 + i;
    sheet.getRow(rowIndex).values = headers.map((h) => record[h]);
    borderRow(sheet, rowIndex, headers.length);
  });
  return headerRowIndex + records.length;
}

function aboutSheet(
  workbook: ExcelJS.Workbook,
  kind: "judges" | "tabulators",
  generatedAt: string
): ExcelJS.Worksheet {
  const source =
    kind === "judges"
      ? "/admin/judges — Panels by event"
      : "/admin/tabulators — Sheets by event";

  const sheet = workbook.addWorksheet("About this export");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait" };
  sheet.columns = [{ width: 12 }, { width: 82 }];
  const startRow = 1;

  writeAoa(
    sheet,
    [
      ["Press Link — adjudication export"],
      [],
      ["Generated", generatedAt],
      ["Source", source],
      [],
      ["How to read a number"],
      ["", "Every number here is the answer to a query. A 0 was measured: no judge has"],
      ["", "been assigned, no qualifier has been drawn, nobody has been placed yet."],
      [],
      ["How to read a sentence"],
      ["", "A sentence where a number belongs is a reason, and it says the figure could"],
      ["", "not be measured at all — never that it was measured and came out at nought."],
      ["", "There are three: no panel is seated, the event has no entries, or no round-2"],
      ["", "cut is on file."],
      [],
      ["The round-2 cut"],
      ["", "Spelled out rather than shown as the division's usual default of 10. The"],
      ["", "column is never empty in the database, so a cut that cannot be printed is a"],
      ["", "value that could not be read — and 10 in its place would report a decision"],
      ["", "nobody took for that event."],
      [],
      ["What this file does not cover"],
      ["", "The writing half of adjudication — seating a panel, closing a round, drawing"],
      ["", "the cut, publishing a sheet — has no functions behind it yet. So an event can"],
      ["", "be read all the way through and still sit at Not started: that is a contest"],
      ["", "nobody has begun judging, not a figure this export failed to fetch."],
    ],
    startRow
  );
  return sheet;
}

function panelSheet(workbook: ExcelJS.Workbook, rows: EventIndexRow[]): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Panels by event");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait" };
  sheet.columns = [34, 24, 17, 12, 9, 44, 40, 40, 62, 20, 74].map((width) => ({ width }));
  const startRow = 1;
  writeTable(sheet, PANEL_HEADER, toPanelRows(rows), startRow);
  return sheet;
}

/**
 * The roster, or the one sentence that stands in for it.
 *
 * The sheet is written either way. An empty roster keeps it and puts the reason
 * where the rows would go: dropping the sheet would leave a reader to conclude the
 * roster was never part of this export, which is the opposite of the truth.
 */
function rosterSheet(
  workbook: ExcelJS.Workbook,
  judges: JudgeRosterExportRow[]
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Judges on file");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait" };

  if (judges.length === 0) {
    sheet.columns = [{ width: 110 }];
    const startRow = 1;
    writeAoa(sheet, [["Judges on file"], [XL_NO_JUDGES]], startRow);
    borderRow(sheet, startRow, 1);
    borderRow(sheet, startRow + 1, 1);
    return sheet;
  }

  sheet.columns = [34, 34, 34, 9, 10].map((width) => ({ width }));
  const startRow = 1;
  writeTable(sheet, ROSTER_HEADER, toRosterRows(judges), startRow);
  return sheet;
}

function tabulationSheet(workbook: ExcelJS.Workbook, rows: EventIndexRow[]): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Sheets by event");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait" };
  sheet.columns = [34, 24, 17, 12, 9, 40, 62, 24, 74].map((width) => ({ width }));
  const startRow = 1;
  writeTable(sheet, TABULATION_HEADER, toTabulationRows(rows), startRow);
  return sheet;
}

/**
 * `generatedAt` is the caller's to supply rather than read from the clock here:
 * a pure builder that stamps itself cannot be asserted on, and the route already
 * needs the date for the filename.
 */
export function buildJudgesWorkbook(
  { rows, judges }: JudgingExportInput,
  generatedAt: string
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  aboutSheet(workbook, "judges", generatedAt);
  panelSheet(workbook, rows);
  rosterSheet(workbook, judges);

  return workbook;
}

export function buildTabulatorsWorkbook(
  { rows }: JudgingExportInput,
  generatedAt: string
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  aboutSheet(workbook, "tabulators", generatedAt);
  tabulationSheet(workbook, rows);
  return workbook;
}

/**
 * One event's identified results sheet, as a workbook.
 *
 * The third builder, and the odd one out: the two above are the index — every
 * event, one line each — while this is a single event's sheet, the same rows
 * `/admin/tabulators/[eventId]` renders. A tabulator wants both. The index says
 * which events are done; the sheet is what gets checked, initialled and filed for
 * one contest, and it is the one that has to leave the building.
 *
 * ## Why it takes the loaded sheet rather than the event id
 *
 * `lib/` does not import from `app/`, so this cannot fetch. `EventSheetExportInput`
 * is structurally what `loadEventSheet` already returns, which means the route
 * hands its loaded sheet straight over and the file and the page are built from
 * one read of one query. A builder with a query of its own is a builder that can
 * disagree with the screen it was downloaded from.
 */
export interface EventSheetExportInput {
  row: EventIndexRow;
  /** The sheet in placement order, identities joined on. Empty when nothing is ranked. */
  rows: SheetRow[];
  /** Codes whose identity could not be joined — printed, never dropped. */
  unidentified: string[];
}

/**
 * The sheet's header, taken from `TABULATION_COLUMNS` rather than written out.
 *
 * That array is the one list of what a tabulator's sheet contains and in which
 * order, and the comment on it says why it is shared: the spreadsheet must not have
 * different columns in a different order from the page it was downloaded from. A
 * literal here is precisely how that would come apart.
 */
export const EVENT_SHEET_HEADER = TABULATION_COLUMNS.map((column) => column.label);

/**
 * The sheet's rows.
 *
 * Every cell goes through `tabulationCell`, the same function the on-screen table
 * calls, so an absent rank is an em dash in both places and a blank never means two
 * different things. The one departure: a numeric column that *has* a figure carries
 * it as a number rather than as its text, because a rank stored as text sorts
 * 1, 10, 11, 2 in a spreadsheet — and sorting the sheet is most of what a tabulator
 * opens it to do. The em dash is untouched by that, so the absence still reads
 * identically to the page.
 */
export function toEventSheetRows(rows: SheetRow[]): Record<string, Cell>[] {
  return rows.map((row) => {
    const record: Record<string, Cell> = {};
    for (const column of TABULATION_COLUMNS) {
      const value = column.key === "coach" ? null : row[column.key];
      record[column.label] =
        column.numeric && typeof value === "number" ? value : tabulationCell(row, column.key);
    }
    return record;
  });
}

/**
 * What this sheet is a sheet of, and how to read it.
 *
 * The index workbooks explain how to read a figure. This one has to say which
 * contest it belongs to first: a results sheet with no event on it is a page of
 * numbers, and it is the half of the file that gets printed and signed.
 *
 * The unidentified count sits here rather than only on the sheet because it is a
 * fault, and a fault has to be met before the numbers it qualifies. The rows are
 * kept either way — see `attachIdentities` for why a dropped row would be worse.
 */
function eventAboutSheet(
  workbook: ExcelJS.Workbook,
  { row, rows, unidentified }: EventSheetExportInput,
  generatedAt: string
): ExcelJS.Worksheet {
  const summary = tabulationSummary(rows);
  const sheet = workbook.addWorksheet("About this export");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait" };
  sheet.columns = [{ width: 16 }, { width: 82 }];

  const unidentifiedLine =
    unidentified.length === 0
      ? "None. Every contestant on this sheet was joined back to a school."
      : `${unidentified.length} — ${unidentified.join(", ")}. Their ranks are correct and their rows are kept, marked Unidentified. A dropped row would read as a contestant who never entered.`;

  writeAoa(
    sheet,
    [
      ["Press Link — results sheet"],
      [],
      ["Event", row.typeNameEn],
      ["Filipino name", filipinoName(row) || row.typeNameEn],
      ["Level · Language", row.slotLabel],
      ["Category", CATEGORY_LABEL[row.category]],
      ["Entries", row.entries],
      ["Round 2 cut", row.round2Cut === null ? XL_CUT_NOT_SET : row.round2Cut],
      ["Status", EVENT_JUDGING_LABEL[row.state.status]],
      ["Why", row.state.reason],
      [],
      ["Generated", generatedAt],
      ["Source", `/admin/tabulators/${row.eventId} — this event's results sheet`],
      [],
      ["Contestants", summary.contestants],
      ["Qualifiers", summary.qualifiers],
      ["Placed", summary.placed],
      ["Unidentified", unidentifiedLine],
      [],
      ["How to read a rank"],
      ["", "Rank R1 is the round-1 judge's own placement, verbatim: a tie stands as it"],
      ["", "was typed and is not renumbered. Rank R2 is the panel's placement of the"],
      ["", "round-2 points beside it. Final points is Rank R1 plus Points R2, and Final"],
      ["", "rank is the placement of that sum — the official one."],
      [],
      ["How to read a dash"],
      ["", "An em dash is not a nought and not a missing cell. It means the figure does"],
      ["", "not exist for that contestant: a non-qualifier has no round-2 anything and no"],
      ["", "final placement at all, and every final rank stays blank until round 2 is"],
      ["", "complete. A 0 in its place would sort as a winning score."],
      [],
      ["Why the points are printed beside the ranks"],
      ["", "So a placement can be checked without going to the database. Points are the"],
      ["", "judges' ranks added; the rank is the placement of those points."],
    ],
    1
  );
  return sheet;
}

/**
 * The sheet itself, or the one sentence that stands in for it.
 *
 * Written either way, for the reason `rosterSheet` gives: dropping it would leave a
 * reader to conclude the sheet was never part of this export. The two absences are
 * different and are worded differently — no cut on file means no field was divided
 * and nothing was computed; no contestants means the event has nobody to rank.
 */
function eventSheet(
  workbook: ExcelJS.Workbook,
  { row, rows }: EventSheetExportInput
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Results sheet");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "landscape" };

  if (rows.length === 0) {
    sheet.columns = [{ width: 110 }];
    writeAoa(
      sheet,
      [
        ["Results sheet"],
        [
          row.round2Cut === null
            ? XL_CUT_NOT_SET
            : "This event has no contestants on file, so there is no sheet to draw.",
        ],
      ],
      1
    );
    borderRow(sheet, 1, 1);
    borderRow(sheet, 2, 1);
    return sheet;
  }

  sheet.columns = [10, 30, 34, 30, 34, 22, 10, 11, 10, 11, 13, 11].map((width) => ({ width }));
  writeTable(sheet, EVENT_SHEET_HEADER, toEventSheetRows(rows), 1);
  return sheet;
}

/**
 * `generatedAt` is the caller's to supply, for the reason the two builders above
 * give: a pure builder that stamps itself cannot be asserted on, and the route
 * already needs the date for the filename.
 */
export function buildEventSheetWorkbook(
  input: EventSheetExportInput,
  generatedAt: string
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  eventAboutSheet(workbook, input, generatedAt);
  eventSheet(workbook, input);
  return workbook;
}
