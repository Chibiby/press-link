import ExcelJS from "exceljs";

import type { EventLanguage } from "@/lib/events-catalog";
import type { AdminSchoolPaperRow } from "@/lib/paper/admin-papers";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";

import { borderRow } from "./borders";

export interface SchoolPapersExportRow {
  District: string;
  "School Name": string;
  "Elementary Paper (English)": string;
  "Elementary Paper (Filipino)": string;
  "Secondary Paper (English)": string;
  "Secondary Paper (Filipino)": string;
  Adviser: string;
  Gender: string;
  Principal: string;
  "Section Head": string;
  "Assistant Head": string;
  Status: string;
}

const HEADERS = [
  "District",
  "School Name",
  "Elementary Paper (English)",
  "Elementary Paper (Filipino)",
  "Secondary Paper (English)",
  "Secondary Paper (Filipino)",
  "Adviser",
  "Gender",
  "Principal",
  "Section Head",
  "Assistant Head",
  "Status",
] as const;
// District and School Name get real room; the four paper-title columns get at
// least as much as School Name, since a filed title can be a whole phrase
// ("The Young Journalist"), longer than any school's name. Adviser/Principal/
// Section Head/Assistant Head are names, medium width. Gender is "M", "F" or
// "M, F" and needs almost none.
const COLUMN_WIDTHS = [20, 34, 34, 34, 34, 34, 24, 10, 24, 24, 24, 20];

/**
 * A grade/language slot's title, blank when the school hasn't filed there.
 * Looked up by level+language rather than trusted by array position, the
 * same defensiveness `slotValue` in events-matrix-workbook.ts applies to its
 * own fixed-order slots — a reorder of `GRADE_LANGUAGE_GRID` should not
 * silently shuffle which column a title lands in here.
 */
function gradeSlotTitle(
  row: AdminSchoolPaperRow,
  level: "elementary" | "secondary",
  language: EventLanguage
): string {
  const slot = row.gradeSlots.find((s) => s.level === level && s.language === language);
  return slot?.title ?? "";
}

/**
 * One row per school, in the order given — `toAdminSchoolPaperRows` already
 * sorts district-then-school, and re-sorting here would be a second place
 * that could drift from it.
 *
 * Every text field is left as an empty string rather than a dash when there
 * is nothing to show. This is the on-screen "genuinely blank, not a dash"
 * rule for the grade slots (see page.tsx's comment on that grid), extended
 * here to the name columns too: unlike a screen, which prints "—" for a
 * human to read, a spreadsheet cell is better left blank so a filter or a
 * formula run over the column doesn't have to special-case the string "—".
 */
export function toSchoolPapersExportRows(
  rows: AdminSchoolPaperRow[]
): SchoolPapersExportRow[] {
  return rows.map((row) => ({
    District: row.districtName,
    "School Name": row.schoolName,
    "Elementary Paper (English)": gradeSlotTitle(row, "elementary", "english"),
    "Elementary Paper (Filipino)": gradeSlotTitle(row, "elementary", "filipino"),
    "Secondary Paper (English)": gradeSlotTitle(row, "secondary", "english"),
    "Secondary Paper (Filipino)": gradeSlotTitle(row, "secondary", "filipino"),
    Adviser: row.adviser,
    Gender: row.gender,
    Principal: row.principal,
    "Section Head": row.sectionHead,
    "Assistant Head": row.assistantHead,
    Status: PAPER_STATUS_LABEL[row.status],
  }));
}

export function buildSchoolPapersWorkbook(rows: AdminSchoolPaperRow[]): ExcelJS.Workbook {
  const tableRows = toSchoolPapersExportRows(rows);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("School Papers");
  // Landscape, not portrait: 12 real columns of district/school/paper-title/name
  // text want the width a landscape page gives, unlike the overall-data sheet's
  // 5 columns or the events matrix's mostly-numeric 8, both of which stay portrait.
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "landscape" };
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
