import ExcelJS from "exceljs";

import type { RegistrySummary } from "@/lib/dashboard/school-registry";

import { borderRow } from "./borders";

export interface SchoolRegistryExportRow {
  "School Name": string;
  "School ID": string;
  District: string;
  "Ind. Learners": number | string;
  "Ind. Coaches": number | string;
  "Grp. Learners": number | string;
  "Grp. Coaches": number | string;
}

const ROW_KEYS = [
  "School Name",
  "School ID",
  "District",
  "Ind. Learners",
  "Ind. Coaches",
  "Grp. Learners",
  "Grp. Coaches",
] as const;

const COLUMN_WIDTHS = [55, 14, 15, 12, 12, 12, 12];

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
    "School Name": row.schoolName,
    "School ID": row.schoolIdNumber,
    District: row.districtName,
    "Ind. Learners": row.individualLearners,
    "Ind. Coaches": row.individualCoaches,
    "Grp. Learners": row.groupLearners,
    "Grp. Coaches": row.groupCoaches,
  }));

  rows.push({
    "School Name": "DIVISION TOTAL",
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

  // Two-row header: School Name/School ID/District each span both rows
  // (vertical merge), Individual and Group each span two sub-columns
  // (horizontal merge) with Learners/Coaches on the second row underneath.
  //
  // Values, alignment, and borders MUST be set before `mergeCells()` runs.
  // `mergeCells()` converts the non-master cells in a range into live
  // pointers to the master cell; setting `row.values` on an already-merged
  // row recreates that row's cells from scratch and silently drops the
  // merge (it never throws — the workbook just serializes with no
  // `<mergeCell>` elements at all).
  const groupRow = 1;
  const labelRow = groupRow + 1;

  sheet.getRow(groupRow).values = [
    "School Name",
    "School ID",
    "District",
    "Individual",
    "",
    "Group",
    "",
  ];
  sheet.getRow(labelRow).values = ["", "", "", "Learners", "Coaches", "Learners", "Coaches"];

  [groupRow, labelRow].forEach((rowIndex) => {
    sheet.getRow(rowIndex).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col >= 4) cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    borderRow(sheet, rowIndex, ROW_KEYS.length);
  });

  sheet.mergeCells(groupRow, 1, labelRow, 1);
  sheet.mergeCells(groupRow, 2, labelRow, 2);
  sheet.mergeCells(groupRow, 3, labelRow, 3);
  sheet.mergeCells(groupRow, 4, groupRow, 5);
  sheet.mergeCells(groupRow, 6, groupRow, 7);

  const dataStartRow = labelRow + 1;
  rows.forEach((row, i) => {
    const rowIndex = dataStartRow + i;
    sheet.getRow(rowIndex).values = ROW_KEYS.map((key) => row[key]);
    borderRow(sheet, rowIndex, ROW_KEYS.length);
  });

  return workbook;
}
