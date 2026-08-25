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
  },
  ...over,
});

describe("toSchoolRegistryExportRows", () => {
  it("keeps one row per school, in the order given, with Individual and Group each split into Learners/Coaches columns", () => {
    const rows = toSchoolRegistryExportRows(summary());

    expect(rows.slice(0, 3)).toEqual([
      {
        "School Name": "Alabel National High School",
        "School ID": "300001",
        District: "Alabel",
        "Ind. Learners": 8,
        "Ind. Coaches": 3,
        "Grp. Learners": 7,
        "Grp. Coaches": 2,
      },
      {
        "School Name": "Malapatan Central",
        "School ID": "300002",
        District: "Malapatan",
        "Ind. Learners": 2,
        "Ind. Coaches": 1,
        "Grp. Learners": 0,
        "Grp. Coaches": 0,
      },
      {
        "School Name": "Maasim Central ES",
        "School ID": "300003",
        District: "Maasim",
        "Ind. Learners": 0,
        "Ind. Coaches": 0,
        "Grp. Learners": 4,
        "Grp. Coaches": 1,
      },
    ]);
  });

  it("ends with DIVISION TOTAL, not the sum of the rows above it", () => {
    const rows = toSchoolRegistryExportRows(summary());

    expect(rows.at(-1)).toEqual({
      "School Name": "DIVISION TOTAL",
      "School ID": "",
      District: "3 of 332 schools",
      "Ind. Learners": 10,
      "Ind. Coaches": 4,
      "Grp. Learners": 11,
      "Grp. Coaches": 3,
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
    expect(rows[0]["School Name"]).toBe("DIVISION TOTAL");
  });

  it("does not add an Integrated column, even for an integrated school", () => {
    const rows = toSchoolRegistryExportRows(summary());
    expect(Object.keys(rows[1])).toEqual([
      "School Name",
      "School ID",
      "District",
      "Ind. Learners",
      "Ind. Coaches",
      "Grp. Learners",
      "Grp. Coaches",
    ]);
  });
});

describe("buildSchoolRegistryWorkbook", () => {
  it("produces a single Schools sheet with a two-row header and data rows at the right offsets", () => {
    const book = buildSchoolRegistryWorkbook(summary());
    expect(book.worksheets.map((s) => s.name)).toEqual(["Schools"]);

    const sheet = book.getWorksheet("Schools")!;

    // No letterhead header on this export — the group-label header row is
    // the sheet's first row.
    const groupRow = 1;
    const labelRow = 2;
    const dataStartRow = 3;

    // Regression guard: `mergeCells()` must run after the header rows'
    // values/styles are set, or exceljs silently drops the merges from the
    // serialized workbook (see the comment in buildSchoolRegistryWorkbook).
    expect(sheet.model.merges.sort()).toEqual(
      ["A1:A2", "B1:B2", "C1:C2", "D1:E1", "F1:G1"].sort()
    );

    // Merged cells: exceljs reports the master's value on every cell in the
    // merged range (not blank), matching how the example file reads too.
    expect(rowValues(sheet, groupRow)).toEqual([
      "School Name",
      "School ID",
      "District",
      "Individual",
      "Individual",
      "Group",
      "Group",
    ]);
    expect(rowValues(sheet, labelRow)).toEqual([
      "School Name",
      "School ID",
      "District",
      "Learners",
      "Coaches",
      "Learners",
      "Coaches",
    ]);

    expect(rowValues(sheet, dataStartRow)).toEqual([
      "Alabel National High School",
      "300001",
      "Alabel",
      8,
      3,
      7,
      2,
    ]);

    // Row dataStartRow + 3 is DIVISION TOTAL, after the three schools.
    expect(rowValues(sheet, dataStartRow + 3)).toEqual([
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
    expect(rowValues(sheet, 3)[0]).toBe("DIVISION TOTAL");
  });
});
