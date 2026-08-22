import * as XLSX from "xlsx";

import type { EventCategory } from "@/lib/events-catalog";
import { boardProgress } from "@/lib/judging/consolidate";
import { eventIndexSummary, type EventIndexRow } from "@/lib/judging/event-index";
import { EVENT_JUDGING_LABEL } from "@/lib/judging/sheet-state";

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
 * that made it — it gets mailed on, opened next month, and read by someone who
 * never saw the preview banner. A bare 0 in a Judges column would then be read
 * as "nobody was assigned", which is a measurement, when the truth is that the
 * table recording assignments does not exist yet.
 *
 * So every structurally-absent cell holds its reason as its value, and the first
 * sheet of each workbook restates what `JudgingPreviewNotice` says on the page.
 * A structural absence must never be printed as a measured zero.
 */

/**
 * The wordings for an absence.
 *
 * These are the workbook's copies of the sentences the index tables put in their
 * tooltips: `NO_PANEL` and `NO_UNITS` in `EventPanelTable`, `NO_QUALIFIERS` and
 * `NO_RESULTS` in `TabulationIndexTable`, and `CUT_NOT_SET` in
 * `JudgingPreviewNotice`. They are copied rather than imported because all three
 * of those are client components and this module is pure — importing them would
 * pull React into lib/, which nothing in lib/ does.
 *
 * If a wording changes on screen it has to change here too. The tests pin every
 * one of them, so a drift fails the suite instead of shipping a workbook that
 * words an absence differently from the page.
 */
export const XL_NO_PANEL = "No panel is seated, so there are no ranks to count.";
export const XL_NO_UNITS = "This event has no entries, so there is nothing to rank.";
export const XL_CUT_NOT_SET =
  "events.round2_cut arrives with migration 0018, so no cut has been chosen for this event.";
export const XL_NO_QUALIFIERS = "round2_qualifiers arrives with migration 0018.";
export const XL_NO_RESULTS =
  "event_rounds, which records the results lock, arrives with migration 0018.";
export const XL_NO_JUDGES =
  "The judges table arrives with migration 0018, so no judge can be listed. This is an absent table, not an empty roster.";

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

export type PanelRow = Record<(typeof PANEL_HEADER)[number], Cell>;
export type TabulationRow = Record<(typeof TABULATION_HEADER)[number], Cell>;

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
    // Never 10. That is the default the RPC will apply, not a decision anyone has
    // taken for this event, and printing it would invent one.
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
    // `EventIndexRow` carries no qualifier or placement count, because the tables
    // that would hold them are not there — which is why `TabulationIndexTable`
    // renders both columns as `NotYetCell`. The workbook says the same in words
    // rather than settling for a zero.
    Qualifiers: XL_NO_QUALIFIERS,
    Placed: XL_NO_RESULTS,
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
      Qualifiers: XL_NO_QUALIFIERS,
      Placed: XL_NO_RESULTS,
      Status: `${summary.locked} of ${summary.events} sheets published`,
      Why: "",
    },
  ];
}

/**
 * The sheet that stops the file being read as a report.
 *
 * `JudgingPreviewNotice` does this job on the page, and a workbook needs it more,
 * because a workbook travels: it arrives with no banner above it and no way to
 * ask what it means. So the disclosure is the first sheet, where a reader meets
 * it before any figure.
 */
function aboutSheet(kind: "judges" | "tabulators", generatedAt: string): XLSX.WorkSheet {
  const source =
    kind === "judges"
      ? "/admin/judges — Panels by event"
      : "/admin/tabulators — Sheets by event";

  const sheet = XLSX.utils.aoa_to_sheet([
    ["Press Link — adjudication layout preview"],
    [],
    ["Generated", generatedAt],
    ["Source", source],
    [],
    ["What in this file is real"],
    ["", "The event list, the entry counts, and each event's status. Events and entries"],
    ["", "come from the events and entries tables, which exist today. The status is"],
    ["", "computed by the same state machine the finished page will use, given a panel"],
    ["", "that is genuinely empty."],
    [],
    ["What is absent"],
    ["", "Migration 0018 has not run, so judges, judge_assignments, judge_sheets,"],
    ["", "judge_ranks, round2_qualifiers and event_rounds are not in the database."],
    ["", "Every cell that would draw on them holds a sentence saying so."],
    [],
    ["", "A sentence in a numeric column means the table is absent — not that the"],
    ["", "figure was measured and came out at nought."],
    [],
    ["", "The round-2 cut is spelled out rather than shown as the agreed default of 10:"],
    ["", "until events.round2_cut is a column, no event has actually been set to it."],
  ]);
  sheet["!cols"] = [{ wch: 12 }, { wch: 82 }];
  return sheet;
}

function panelSheet(rows: EventIndexRow[]): XLSX.WorkSheet {
  const sheet = XLSX.utils.json_to_sheet(toPanelRows(rows), {
    header: [...PANEL_HEADER],
  });
  sheet["!cols"] = [34, 24, 17, 12, 9, 44, 40, 40, 62, 20, 74].map((wch) => ({ wch }));
  return sheet;
}

function tabulationSheet(rows: EventIndexRow[]): XLSX.WorkSheet {
  const sheet = XLSX.utils.json_to_sheet(toTabulationRows(rows), {
    header: [...TABULATION_HEADER],
  });
  sheet["!cols"] = [34, 24, 17, 12, 9, 40, 62, 24, 74].map((wch) => ({ wch }));
  return sheet;
}

/**
 * `generatedAt` is the caller's to supply rather than read from the clock here:
 * a pure builder that stamps itself cannot be asserted on, and the route already
 * needs the date for the filename.
 */
export function buildJudgesWorkbook(rows: EventIndexRow[], generatedAt: string): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, aboutSheet("judges", generatedAt), "About this export");
  XLSX.utils.book_append_sheet(book, panelSheet(rows), "Panels by event");

  // The page carries an empty roster table above the panel table. The workbook
  // keeps the sheet so the shape matches, and says in it why it has no rows —
  // dropping the sheet would leave a reader to conclude the roster was never
  // part of this, which is the opposite of the truth.
  const roster = XLSX.utils.aoa_to_sheet([["Judges on file"], [XL_NO_JUDGES]]);
  roster["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(book, roster, "Judges on file");

  return book;
}

export function buildTabulatorsWorkbook(
  rows: EventIndexRow[],
  generatedAt: string
): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, aboutSheet("tabulators", generatedAt), "About this export");
  XLSX.utils.book_append_sheet(book, tabulationSheet(rows), "Sheets by event");
  return book;
}
