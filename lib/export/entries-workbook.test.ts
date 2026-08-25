import { describe, expect, it } from "vitest";
import type { CellValue, Worksheet } from "exceljs";

import { buildEntriesWorkbook, toExportRows, type ExportEntry } from "./entries-workbook";

function rowValues(sheet: Worksheet, rowNumber: number): CellValue[] {
  return (sheet.getRow(rowNumber).values as CellValue[]).slice(1);
}

const individual: ExportEntry = {
  schoolName: "A F. Dela Cruz ES",
  districtName: "Alabel 1",
  eventName: "News Writing",
  category: "individual",
  level: "elementary",
  language: "english",
  submittedAt: "2026-08-13 09:30",
  participants: [
    { participantNumber: 1, firstName: "Ana", middleName: "Reyes", lastName: "Cruz", gender: "F" },
  ],
  coaches: [{ fullName: "Mr. Santos", gender: "M" }],
};

const group: ExportEntry = {
  schoolName: "Alabel NHS",
  districtName: "Alabel 2",
  eventName: "Radio Broadcasting and Scriptwriting (Regular)",
  category: "group",
  level: "secondary",
  language: "filipino",
  submittedAt: "2026-08-13 10:00",
  participants: [
    { participantNumber: 1, firstName: "Ben", middleName: null, lastName: "Lim", gender: "M" },
    { participantNumber: 2, firstName: "Cara", middleName: "P", lastName: "Diaz", gender: "F" },
    { participantNumber: 3, firstName: "Dino", middleName: null, lastName: "Uy", gender: "M" },
  ],
  coaches: [
    { fullName: "Ms. Tan", gender: "F" },
    { fullName: "Mr. Go", gender: "M" },
  ],
};

describe("toExportRows", () => {
  it("emits one row per participant", () => {
    expect(toExportRows([individual, group])).toHaveLength(4);
  });

  it("repeats the entry-level fields across a group's rows", () => {
    const rows = toExportRows([group]);
    for (const row of rows) {
      expect(row.School).toBe("Alabel NHS");
      expect(row.District).toBe("Alabel 2");
      expect(row.Event).toBe("Radio Broadcasting and Scriptwriting (Regular)");
      expect(row.Category).toBe("Group");
      expect(row.Level).toBe("Secondary");
      expect(row.Language).toBe("Filipino");
      expect(row.Coaches).toBe("Ms. Tan (F); Mr. Go (M)");
      expect(row.Submitted).toBe("2026-08-13 10:00");
    }
    expect(rows.map((r) => r.Participant)).toEqual([
      "Lim, Ben",
      "Diaz, Cara P",
      "Uy, Dino",
    ]);
    expect(rows.map((r) => r.Gender)).toEqual(["M", "F", "M"]);
    expect(rows.map((r) => r["No."])).toEqual(["0001", "0002", "0003"]);
  });

  it("still emits a row when an entry has no participants", () => {
    const rows = toExportRows([{ ...individual, participants: [] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].Participant).toBe("");
    expect(rows[0].Gender).toBe("");
  });

  it("handles a missing submitted_at", () => {
    expect(toExportRows([{ ...individual, submittedAt: null }])[0].Submitted).toBe("");
  });
});

describe("buildEntriesWorkbook", () => {
  const headerRowIndex = 1;

  it("produces a single Entries sheet that round-trips", () => {
    const book = buildEntriesWorkbook([individual, group]);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Entries"]);

    const sheet = book.getWorksheet("Entries")!;
    expect(rowValues(sheet, headerRowIndex)).toEqual([
      "No.",
      "School",
      "District",
      "Event",
      "Category",
      "Level",
      "Language",
      "Participant",
      "Gender",
      "Coaches",
      "Submitted",
    ]);

    const firstDataRow = rowValues(sheet, headerRowIndex + 1);
    expect(firstDataRow).toEqual([
      "0001",
      "A F. Dela Cruz ES",
      "Alabel 1",
      "News Writing",
      "Individual",
      "Elementary",
      "English",
      "Cruz, Ana Reyes",
      "F",
      "Mr. Santos (M)",
      "2026-08-13 09:30",
    ]);
    expect(rowValues(sheet, headerRowIndex + 5)).toEqual([]);
  });

  it("produces an empty sheet for no entries", () => {
    const book = buildEntriesWorkbook([]);
    const sheet = book.getWorksheet("Entries")!;
    expect(rowValues(sheet, headerRowIndex + 1)).toEqual([]);
  });

  it("borders all four sides of every column-header and data cell", () => {
    const book = buildEntriesWorkbook([individual]);
    const sheet = book.getWorksheet("Entries")!;

    for (const rowNumber of [headerRowIndex, headerRowIndex + 1]) {
      const row = sheet.getRow(rowNumber);
      for (let col = 1; col <= 11; col += 1) {
        const border = row.getCell(col).border;
        expect(border?.top?.style).toBe("thin");
        expect(border?.left?.style).toBe("thin");
        expect(border?.bottom?.style).toBe("thin");
        expect(border?.right?.style).toBe("thin");
      }
    }
  });
});

describe("participant numbers", () => {
  it("puts the zero-padded number in its own leading column", () => {
    const rows = toExportRows([
      {
        schoolName: "Bagumbayan ES",
        districtName: "District I",
        eventName: "News Writing",
        category: "individual",
        level: "elementary",
        language: "english",
        submittedAt: null,
        participants: [
          {
            participantNumber: 7,
            firstName: "Ana",
            middleName: null,
            lastName: "Dela Cruz",
            gender: "F",
          },
        ],
        coaches: [{ fullName: "Mr. Reyes", gender: "M" }],
      },
    ]);
    expect(rows[0]["No."]).toBe("0007");
    expect(rows[0].Participant).toBe("Dela Cruz, Ana");
  });
});
