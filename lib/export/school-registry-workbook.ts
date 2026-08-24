import ExcelJS from "exceljs";

import type { RegistrySummary } from "@/lib/dashboard/school-registry";

import { addLetterhead, LETTERHEAD_ROWS } from "./letterhead";

export interface SchoolRegistryExportRow {
  School: string;
  "School ID": string;
  District: string;
  "Individual Learners": number | string;
  "Individual Coaches": number | string;
  "Group Learners": number | string;
  "Group Coaches": number | string;
}

const HEADERS = [
  "School",
  "School ID",
  "District",
  "Individual Learners",
  "Individual Coaches",
  "Group Learners",
  "Group Coaches",
] as const;

const COLUMN_WIDTHS = [40, 16, 24, 16, 16, 16, 16];

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
    "Individual Learners": row.individualLearners,
    "Individual Coaches": row.individualCoaches,
    "Group Learners": row.groupLearners,
    "Group Coaches": row.groupCoaches,
  }));

  rows.push({
    School: "DIVISION TOTAL",
    "School ID": "",
    District: `${summary.shown} of ${summary.registered} schools`,
    "Individual Learners": summary.totals.individualLearners,
    "Individual Coaches": summary.totals.individualCoaches,
    "Group Learners": summary.totals.groupLearners,
    "Group Coaches": summary.totals.groupCoaches,
  });

  return rows;
}

export function buildSchoolRegistryWorkbook(summary: RegistrySummary): ExcelJS.Workbook {
  const rows = toSchoolRegistryExportRows(summary);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Schools");
  addLetterhead(workbook, sheet);
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const headerRowIndex = LETTERHEAD_ROWS + 1;
  sheet.getRow(headerRowIndex).values = [...HEADERS];

  rows.forEach((row, i) => {
    sheet.getRow(headerRowIndex + 1 + i).values = HEADERS.map((header) => row[header]);
  });

  return workbook;
}
