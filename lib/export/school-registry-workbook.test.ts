import { describe, expect, it } from "vitest";
import type { CellValue, Worksheet } from "exceljs";

import type { RegistrySummary } from "@/lib/dashboard/school-registry";

import {
  buildSchoolRegistryWorkbook,
  toSchoolRegistryExportRows,
} from "./school-registry-workbook";
import { LETTERHEAD_ROWS } from "./letterhead";

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
  },
  ...over,
});

describe("toSchoolRegistryExportRows", () => {
  it("keeps one row per school, in the order given, mirroring the four visible columns", () => {
    const rows = toSchoolRegistryExportRows(summary());

    expect(rows.slice(0, 3)).toEqual([
      {
        School: "Alabel National High School",
        "School ID": "300001",
        District: "Alabel",
        "Individual Learners": 8,
        "Individual Coaches": 3,
        "Group Learners": 7,
        "Group Coaches": 2,
      },
      {
        School: "Malapatan Central",
        "School ID": "300002",
        District: "Malapatan",
        "Individual Learners": 2,
        "Individual Coaches": 1,
        "Group Learners": 0,
        "Group Coaches": 0,
      },
      {
        School: "Maasim Central ES",
        "School ID": "300003",
        District: "Maasim",
        "Individual Learners": 0,
        "Individual Coaches": 0,
        "Group Learners": 4,
        "Group Coaches": 1,
      },
    ]);
  });

  it("ends with DIVISION TOTAL, not the sum of the rows above it", () => {
    const rows = toSchoolRegistryExportRows(summary());

    expect(rows.at(-1)).toEqual({
      School: "DIVISION TOTAL",
      "School ID": "",
      District: "3 of 332 schools",
      "Individual Learners": 10,
      "Individual Coaches": 4,
      "Group Learners": 11,
      "Group Coaches": 3,
    });
  });

  it("still emits the total row when no school is shown", () => {
    const rows = toSchoolRegistryExportRows(
      summary({
        rows: [],
        shown: 0,
        totals: { individualLearners: 0, individualCoaches: 0, groupLearners: 0, groupCoaches: 0 },
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
      "Individual Learners",
      "Individual Coaches",
      "Group Learners",
      "Group Coaches",
    ]);
  });
});

describe("buildSchoolRegistryWorkbook", () => {
  const headerRowIndex = LETTERHEAD_ROWS + 1;

  it("produces a single Schools sheet with the header and data rows at the right offsets", () => {
    const book = buildSchoolRegistryWorkbook(summary());
    expect(book.worksheets.map((s) => s.name)).toEqual(["Schools"]);

    const sheet = book.getWorksheet("Schools")!;
    expect(rowValues(sheet, headerRowIndex)).toEqual([
      "School",
      "School ID",
      "District",
      "Individual Learners",
      "Individual Coaches",
      "Group Learners",
      "Group Coaches",
    ]);

    expect(rowValues(sheet, headerRowIndex + 1)).toEqual([
      "Alabel National High School",
      "300001",
      "Alabel",
      8,
      3,
      7,
      2,
    ]);

    // Row 4 is DIVISION TOTAL, after the three schools.
    expect(rowValues(sheet, headerRowIndex + 4)).toEqual([
      "DIVISION TOTAL",
      "",
      "3 of 332 schools",
      10,
      4,
      11,
      3,
    ]);
  });

  it("still writes the total row for an empty registry", () => {
    const book = buildSchoolRegistryWorkbook(
      summary({
        rows: [],
        shown: 0,
        totals: { individualLearners: 0, individualCoaches: 0, groupLearners: 0, groupCoaches: 0 },
      })
    );
    const sheet = book.getWorksheet("Schools")!;
    expect(rowValues(sheet, headerRowIndex + 1)[0]).toBe("DIVISION TOTAL");
  });
});
