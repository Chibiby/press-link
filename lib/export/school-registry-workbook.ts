import ExcelJS from "exceljs";

import type { RegistrySummary } from "@/lib/dashboard/school-registry";

import { borderRow } from "./borders";
import { addExportHeader } from "./letterhead";

export interface SchoolRegistryExportRow {
  School: string;
  "School ID": string;
  District: string;
  "Ind. Learners": number | string;
  "Ind. Coaches": number | string;
  "Grp. Learners": number | string;
  "Grp. Coaches": number | string;
}

const HEADERS = [
  "School",
  "School ID",
  "District",
  "Ind. Learners",
  "Ind. Coaches",
  "Grp. Learners",
  "Grp. Coaches",
] as const;

const COLUMN_WIDTHS = [55, 16, 24, 16, 16, 16, 16];

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
    "Ind. Learners": row.individualLearners,
    "Ind. Coaches": row.individualCoaches,
    "Grp. Learners": row.groupLearners,
    "Grp. Coaches": row.groupCoaches,
  }));

  rows.push({
    School: "DIVISION TOTAL",
    "School ID": "",
    District: `${summary.shown} of ${summary.registered} schools`,
    "Ind. Learners": summary.totals.individualLearners,
    "Ind. Coaches": summary.totals.individualCoaches,
    "Grp. Learners": summary.totals.groupLearners,
    "Grp. Coaches": summary.totals.groupCoaches,
  });

  return rows;
}

export function buildSchoolRegistryWorkbook(summary: RegistrySummary): ExcelJS.Workbook {
  const rows = toSchoolRegistryExportRows(summary);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Schools");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "portrait", scale: 60 };
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));
  const headerRowIndex = addExportHeader(workbook, sheet);

  sheet.getRow(headerRowIndex).values = [...HEADERS];
  borderRow(sheet, headerRowIndex, HEADERS.length);

  rows.forEach((row, i) => {
    const rowIndex = headerRowIndex + 1 + i;
    sheet.getRow(rowIndex).values = HEADERS.map((header) => row[header]);
    borderRow(sheet, rowIndex, HEADERS.length);
  });

  return workbook;
}
