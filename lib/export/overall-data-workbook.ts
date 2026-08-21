import * as XLSX from "xlsx";

import type { PerSchoolSummary } from "@/lib/dashboard/per-school";

export interface OverallDataRow {
  School: string;
  District: string;
  Learners: number | string;
  Coaches: number | string;
  Entries: number | string;
}

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

export function buildOverallDataWorkbook(summary: PerSchoolSummary): XLSX.WorkBook {
  const sheet = XLSX.utils.json_to_sheet(toOverallDataRows(summary), {
    header: ["School", "District", "Learners", "Coaches", "Entries"],
  });
  sheet["!cols"] = [40, 24, 12, 12, 12].map((wch) => ({ wch }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Overall Data");
  return book;
}
