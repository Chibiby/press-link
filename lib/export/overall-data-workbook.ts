import ExcelJS from "exceljs";

import type { PerSchoolSummary } from "@/lib/dashboard/per-school";

import { borderRow } from "./borders";

export interface OverallDataRow {
  School: string;
  District: string;
  Learners: number | string;
  Coaches: number | string;
  Entries: number | string;
}

const HEADERS = ["School", "District", "Learners", "Coaches", "Entries"] as const;
const COLUMN_WIDTHS = [40, 24, 12, 12, 12];

/**
 * One row per school, then the division total — the same two-part shape as the
 * dashboard table, so a printed sheet and the screen can be read side by side.
 *
 * The total is `summary.totals`, which Task 8 computes over every active school
 * including the ones a top-N cut. That is deliberate, and the District cell on
 * that row says so in words, because a spreadsheet has no footnote.
 */
export function toOverallDataRows(summary: PerSchoolSummary): OverallDataRow[] {
  const rows: OverallDataRow[] = summary.rows.map((row) => ({
    School: row.schoolName,
    District: row.districtName,
    Learners: row.learners,
    Coaches: row.coaches,
    Entries: row.entries,
  }));

  rows.push({
    School: "DIVISION TOTAL",
    District: `${summary.activeSchools} of ${summary.registeredSchools} schools`,
    Learners: summary.totals.learners,
    Coaches: summary.totals.coaches,
    Entries: summary.totals.entries,
  });

  return rows;
}

export function buildOverallDataWorkbook(summary: PerSchoolSummary): ExcelJS.Workbook {
  const rows = toOverallDataRows(summary);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Overall Data");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait" };
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));
  const headerRowIndex = 1;

  sheet.getRow(headerRowIndex).values = [...HEADERS];
  borderRow(sheet, headerRowIndex, HEADERS.length);

  rows.forEach((row, i) => {
    const rowIndex = headerRowIndex + 1 + i;
    sheet.getRow(rowIndex).values = HEADERS.map((header) => row[header]);
    borderRow(sheet, rowIndex, HEADERS.length);
  });

  return workbook;
}
