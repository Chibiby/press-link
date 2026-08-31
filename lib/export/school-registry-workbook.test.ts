import { describe, expect, it } from "vitest";
import type { CellValue, Worksheet } from "exceljs";

import type { RegistrySummary } from "@/lib/dashboard/school-registry";

import {
  buildSchoolRegistryWorkbook,
  toSchoolRegistryExportRows,
} from "./school-registry-workbook";

function rowValues(sheet: Worksheet, rowNumber: number): CellValue[] {
  return (sheet.getRow(rowNumber).values as CellValue[]).slice(1);
}

const summary = (over: Partial<RegistrySummary> = {}): RegistrySummary => ({
  rows: [
    {
      schoolId: "a",
      schoolName: "Alabel National High School",
      schoolIdNumber: "300001",
      districtId: "d-alabel",
      districtName: "Alabel",
      isIntegrated: false,
      learners: 20,
      coaches: 6,
      entries: 12,
      individualLearners: 8,
      individualCoaches: 3,
      groupLearners: 7,
      groupCoaches: 2,
      lockedAt: null,
    },
    {
      schoolId: "b",
      schoolName: "Malapatan Central",
      schoolIdNumber: "300002",
      districtId: "d-malapatan",
      districtName: "Malapatan",
      isIntegrated: true,
      learners: 5,
      coaches: 2,
      entries: 3,
      individualLearners: 2,
      individualCoaches: 1,
      groupLearners: 0,
      groupCoaches: 0,
      lockedAt: "2026-08-10T02:00:00+00:00",
    },
    {
      schoolId: "c",
      schoolName: "Maasim Central ES",
      schoolIdNumber: "300003",
      districtId: "d-maasim",
      districtName: "Maasim",
      isIntegrated: false,
      learners: 0,
      coaches: 0,
      entries: 0,
      individualLearners: 0,
      individualCoaches: 0,
      groupLearners: 4,
      groupCoaches: 1,
      lockedAt: null,
    },
  ],
  shown: 3,
  registered: 332,
  totals: {
    individualLearners: 10,
    individualCoaches: 4,
    groupLearners: 11,
    groupCoaches: 3,
    delegates: 28,
  },
  ...over,
});

describe("toSchoolRegistryExportRows", () => {
  it("keeps one row per school, in the order given, combining learners and coaches into one cell per category", () => {
    const rows = toSchoolRegistryExportRows(summary());

    expect(rows.slice(0, 3)).toEqual([
      {
        School: "Alabel National High School",
        "School ID": "300001",
        District: "Alabel",
        Individual: "Learners: 8\nCoaches: 3",
        Group: "Learners: 7\nCoaches: 2",
        Total: 20,
      },
      {
        School: "Malapatan Central",
        "School ID": "300002",
        District: "Malapatan",
        Individual: "Learners: 2\nCoaches: 1",
        Group: "Learners: 0\nCoaches: 0",
        Total: 3,
      },
      {
        School: "Maasim Central ES",
        "School ID": "300003",
        District: "Maasim",
        Individual: "Learners: 0\nCoaches: 0",
        Group: "Learners: 4\nCoaches: 1",
        Total: 5,
      },
    ]);
  });

  it("ends with DIVISION TOTAL, not the sum of the rows above it", () => {
    const rows = toSchoolRegistryExportRows(summary());

    expect(rows.at(-1)).toEqual({
      School: "DIVISION TOTAL",
      "School ID": "",
      District: "3 of 332 schools",
      Individual: "Learners: 10\nCoaches: 4",
      Group: "Learners: 11\nCoaches: 3",
      // The four columns of the total row, added.
      Total: 28,
    });
  });

  it("still emits the total row when no school is shown", () => {
    const rows = toSchoolRegistryExportRows(
      summary({
        rows: [],
        shown: 0,
        totals: { individualLearners: 0, individualCoaches: 0, groupLearners: 0, groupCoaches: 0, delegates: 0 },
      })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].School).toBe("DIVISION TOTAL");
  });

  it("does not add an Integrated column, even for an integrated school", () => {
    const rows = toSchoolRegistryExportRows(summary());
    expect(Object.keys(rows[1])).toEqual([
      "School",
      "School ID",
      "District",
      "Individual",
      "Group",
      "Total",
    ]);
  });
});

describe("buildSchoolRegistryWorkbook", () => {
  const headerRowIndex = 1;

  it("produces a single Schools sheet with the header and data rows at the right offsets", () => {
    const book = buildSchoolRegistryWorkbook(summary());
    expect(book.worksheets.map((s) => s.name)).toEqual(["Schools"]);

    const sheet = book.getWorksheet("Schools")!;
    expect(rowValues(sheet, headerRowIndex)).toEqual([
      "School",
      "School ID",
      "District",
      "Individual",
      "Group",
      "Total",
    ]);

    expect(rowValues(sheet, headerRowIndex + 1)).toEqual([
      "Alabel National High School",
      "300001",
      "Alabel",
      "Learners: 8\nCoaches: 3",
      "Learners: 7\nCoaches: 2",
      // A number, because this is the one cell anybody will sort or sum on.
      20,
    ]);

    // Row 4 is DIVISION TOTAL, after the three schools.
    expect(rowValues(sheet, headerRowIndex + 4)).toEqual([
      "DIVISION TOTAL",
      "",
      "3 of 332 schools",
      "Learners: 10\nCoaches: 4",
      "Learners: 11\nCoaches: 3",
      28,
    ]);
  });

  it("still writes the total row for an empty registry", () => {
    const book = buildSchoolRegistryWorkbook(
      summary({
        rows: [],
        shown: 0,
        totals: { individualLearners: 0, individualCoaches: 0, groupLearners: 0, groupCoaches: 0, delegates: 0 },
      })
    );
    const sheet = book.getWorksheet("Schools")!;
    expect(rowValues(sheet, headerRowIndex + 1)[0]).toBe("DIVISION TOTAL");
  });

  it("applies wrapText alignment to the Individual and Group cells but not the other columns", () => {
    const book = buildSchoolRegistryWorkbook(summary());
    const sheet = book.getWorksheet("Schools")!;
    const dataRow = sheet.getRow(headerRowIndex + 1);

    expect(dataRow.getCell(4).alignment).toEqual({ wrapText: true, vertical: "middle" });
    expect(dataRow.getCell(5).alignment).toEqual({ wrapText: true, vertical: "middle" });
    expect(dataRow.getCell(1).alignment).toBeUndefined();
  });
});
