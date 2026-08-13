import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildEntriesWorkbook, toExportRows, type ExportEntry } from "./entries-workbook";

const individual: ExportEntry = {
  schoolName: "A F. Dela Cruz ES",
  districtName: "Alabel 1",
  eventName: "News Writing",
  category: "individual",
  level: "elementary",
  language: "english",
  submittedAt: "2026-08-13 09:30",
  participants: [
    { firstName: "Ana", middleName: "Reyes", lastName: "Cruz", gender: "F" },
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
    { firstName: "Ben", middleName: null, lastName: "Lim", gender: "M" },
    { firstName: "Cara", middleName: "P", lastName: "Diaz", gender: "F" },
    { firstName: "Dino", middleName: null, lastName: "Uy", gender: "M" },
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
  it("produces a single Entries sheet that round-trips", () => {
    const book = buildEntriesWorkbook([individual, group]);
    expect(book.SheetNames).toEqual(["Entries"]);

    const parsed = XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets.Entries);
    expect(parsed).toHaveLength(4);
    expect(Object.keys(parsed[0])).toEqual([
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
  });

  it("produces an empty sheet for no entries", () => {
    const book = buildEntriesWorkbook([]);
    expect(XLSX.utils.sheet_to_json(book.Sheets.Entries)).toEqual([]);
  });
});
