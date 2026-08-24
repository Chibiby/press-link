import ExcelJS from "exceljs";

import type { RegistrySummary } from "@/lib/dashboard/school-registry";

import { borderRow } from "./borders";

export interface SchoolRegistryExportRow {
  School: string;
  "School ID": string;
  District: string;
  Individual: string;
  Group: string;
}

const HEADERS = ["School", "School ID", "District", "Individual", "Group"] as const;

const COLUMN_WIDTHS = [55, 16, 24, 16, 16];

/** Columns (1-based) whose cells hold the two-line "Learners: N\nCoaches: N" strings. */
const WRAPPED_COLUMNS = [4, 5];

/**
 * One row per school, then DIVISION TOTAL — same two-part shape as
 * toOverallDataRows() in overall-data-workbook.ts, built from the same
 * RegistrySummary the page renders. The total row's own District cell says
 * "N of M schools" for the same reason that one does: a spreadsheet has no
 * footnote, and `summary.totals` is a sum over the shown rows, not the whole
 * division roll.
 */
export function toSchoolRegistryExportRows(
  summary: RegistrySummary
): SchoolRegistryExportRow[] {
  const rows: SchoolRegistryExportRow[] = summary.rows.map((row) => ({
    School: row.schoolName,
    "School ID": row.schoolIdNumber,
    District: row.districtName,
    Individual: `Learners: ${row.individualLearners}\nCoaches: ${row.individualCoaches}`,
    Group: `Learners: ${row.groupLearners}\nCoaches: ${row.groupCoaches}`,
  }));

  rows.push({
    School: "DIVISION TOTAL",
    "School ID": "",
    District: `${summary.shown} of ${summary.registered} schools`,
    Individual: `Learners: ${summary.totals.individualLearners}\nCoaches: ${summary.totals.individualCoaches}`,
    Group: `Learners: ${summary.totals.groupLearners}\nCoaches: ${summary.totals.groupCoaches}`,
  });

  return rows;
}

export function buildSchoolRegistryWorkbook(summary: RegistrySummary): ExcelJS.Workbook {
  const rows = toSchoolRegistryExportRows(summary);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Schools");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait", scale: 60 };
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const headerRowIndex = 1;
  sheet.getRow(headerRowIndex).values = [...HEADERS];
  borderRow(sheet, headerRowIndex, HEADERS.length);

  rows.forEach((row, i) => {
    const rowIndex = headerRowIndex + 1 + i;
    const excelRow = sheet.getRow(rowIndex);
    excelRow.values = HEADERS.map((header) => row[header]);
    excelRow.height = 30;
    WRAPPED_COLUMNS.forEach((col) => {
      excelRow.getCell(col).alignment = { wrapText: true, vertical: "middle" };
    });
    borderRow(sheet, rowIndex, HEADERS.length);
  });

  return workbook;
}
