import ExcelJS from "exceljs";

import { teamSize, type EventMatrixRow, type EventSlotKey } from "@/lib/dashboard/event-matrix";

import { borderRow } from "./borders";

export interface EventsMatrixRow {
  "Event Type (English)": string;
  "Event Type (Filipino)": string;
  "Team Size": string;
  "Elem · Eng": number | string;
  "Elem · Fil": number | string;
  "Sec · Eng": number | string;
  "Sec · Fil": number | string;
  Entries: number;
}

const HEADERS = [
  "Event Type (English)",
  "Event Type (Filipino)",
  "Team Size",
  "Elem · Eng",
  "Elem · Fil",
  "Sec · Eng",
  "Sec · Fil",
  "Entries",
] as const;
const COLUMN_WIDTHS = [32, 32, 14, 10, 10, 10, 10, 10];

/**
 * The number in a slot cell, or an em dash for a contest not offered at that
 * level. Reproduces the rule MatrixTable applies on screen (see the em-dash
 * branch there) so the download reads exactly like the table it was
 * downloaded from — a `0` here would read as "nobody entered" rather than
 * "not offered".
 */
function slotValue(row: EventMatrixRow, key: EventSlotKey): number | string {
  const cell = row.slots[key];
  return cell === null ? "—" : cell.entries;
}

/**
 * One row per contest type — the same rows MatrixTable lists, in the same
 * order, with the same em-dash-for-null rule on the four slot columns.
 */
export function toEventsMatrixRows(rows: EventMatrixRow[]): EventsMatrixRow[] {
  return rows.map((row) => ({
    "Event Type (English)": row.typeNameEn,
    "Event Type (Filipino)": row.typeNameFil,
    "Team Size": teamSize(row),
    "Elem · Eng": slotValue(row, "elementary-english"),
    "Elem · Fil": slotValue(row, "elementary-filipino"),
    "Sec · Eng": slotValue(row, "secondary-english"),
    "Sec · Fil": slotValue(row, "secondary-filipino"),
    Entries: row.entries,
  }));
}

export function buildEventsMatrixWorkbook(
  rows: EventMatrixRow[],
  sheetTitle: string
): ExcelJS.Workbook {
  const tableRows = toEventsMatrixRows(rows);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetTitle);
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait" };
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));
  const headerRowIndex = 1;

  sheet.getRow(headerRowIndex).values = [...HEADERS];
  borderRow(sheet, headerRowIndex, HEADERS.length);

  tableRows.forEach((row, i) => {
    const rowIndex = headerRowIndex + 1 + i;
    sheet.getRow(rowIndex).values = HEADERS.map((header) => row[header]);
    borderRow(sheet, rowIndex, HEADERS.length);
  });

  return workbook;
}
