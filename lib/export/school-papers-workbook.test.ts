import { describe, expect, it } from "vitest";

import type { AdminSchoolPaperRow } from "@/lib/paper/admin-papers";

import { toSchoolPapersExportRows } from "./school-papers-workbook";

const adminSchoolPaperRow = (
  overrides: Partial<AdminSchoolPaperRow> = {}
): AdminSchoolPaperRow => ({
  id: "s1",
  schoolName: "Bagumbayan ES",
  districtId: "d1",
  districtName: "District I",
  status: "submitted",
  locked: false,
  isIntegrated: true,
  slots: [],
  languages: ["english", "filipino"],
  completeLanguages: ["english", "filipino"],
  gradeSlots: [
    { level: "elementary", language: "english", title: "The Young Journalist" },
    { level: "elementary", language: "filipino", title: "Ang Batang Mamamahayag" },
    { level: "secondary", language: "english", title: "The Campus Voice" },
    { level: "secondary", language: "filipino", title: "Ang Tinig ng Paaralan" },
  ],
  adviser: "Juana Cruz",
  gender: "F",
  principal: "Pedro Reyes",
  sectionHead: ["Maria Santos"],
  assistantHead: "Jose Rizal",
  ...overrides,
});

describe("toSchoolPapersExportRows", () => {
  it("carries district, school name and the five combined names straight across", () => {
    const rows = toSchoolPapersExportRows([adminSchoolPaperRow()]);

    expect(rows[0].District).toBe("District I");
    expect(rows[0]["School Name"]).toBe("Bagumbayan ES");
    expect(rows[0].Adviser).toBe("Juana Cruz");
    expect(rows[0].Gender).toBe("F");
    expect(rows[0].Principal).toBe("Pedro Reyes");
    expect(rows[0]["Section Head"]).toBe("Maria Santos");
    expect(rows[0]["Assistant Head"]).toBe("Jose Rizal");
  });

  it("joins every section head with a comma, unlike the on-screen cell it never truncates", () => {
    const rows = toSchoolPapersExportRows([
      adminSchoolPaperRow({
        sectionHead: ["Ana Lim", "Ben Cruz", "Cel Reyes", "Dodong Santos"],
      }),
    ]);

    expect(rows[0]["Section Head"]).toBe("Ana Lim, Ben Cruz, Cel Reyes, Dodong Santos");
  });

  it("matches each grade-slot column by level and language, not by array position", () => {
    // gradeSlots deliberately given out of the grid's natural order — a lookup
    // that trusted position instead of level+language would land titles in the
    // wrong columns here while still passing a test that kept the natural order.
    const rows = toSchoolPapersExportRows([
      adminSchoolPaperRow({
        gradeSlots: [
          { level: "secondary", language: "english", title: "Secondary English Title" },
          { level: "secondary", language: "filipino", title: "Secondary Filipino Title" },
          { level: "elementary", language: "filipino", title: "Elementary Filipino Title" },
          { level: "elementary", language: "english", title: "Elementary English Title" },
        ],
      }),
    ]);

    expect(rows[0]["Elementary Paper (English)"]).toBe("Elementary English Title");
    expect(rows[0]["Elementary Paper (Filipino)"]).toBe("Elementary Filipino Title");
    expect(rows[0]["Secondary Paper (English)"]).toBe("Secondary English Title");
    expect(rows[0]["Secondary Paper (Filipino)"]).toBe("Secondary Filipino Title");
  });

  it("renders a null slot title as an empty string, not the word null or a dash", () => {
    const rows = toSchoolPapersExportRows([
      adminSchoolPaperRow({
        gradeSlots: [
          { level: "elementary", language: "english", title: null },
          { level: "elementary", language: "filipino", title: "Filed" },
          { level: "secondary", language: "english", title: "Filed" },
          { level: "secondary", language: "filipino", title: "Filed" },
        ],
      }),
    ]);

    expect(rows[0]["Elementary Paper (English)"] === "").toBe(true);
  });

  it.each([
    ["incomplete", "Not started"],
    ["saved", "Info saved only"],
    ["submitted", "Submitted to contest"],
  ] as const)("maps status %s to its label %s, never leaking the raw enum value", (status, label) => {
    const rows = toSchoolPapersExportRows([adminSchoolPaperRow({ status })]);

    expect(rows[0].Status).toBe(label);
    expect(rows[0].Status).not.toBe(status);
  });

  it("leaves an empty adviser/gender/principal/section head/assistant head as an empty string", () => {
    // Unlike the on-screen table, which prints "—" for nothing on file, a
    // spreadsheet cell with nothing to show should stay genuinely blank rather
    // than carry a dash a filter or formula would have to special-case.
    const rows = toSchoolPapersExportRows([
      adminSchoolPaperRow({
        adviser: "",
        gender: "",
        principal: "",
        sectionHead: [],
        assistantHead: "",
      }),
    ]);

    expect(rows[0].Adviser).toBe("");
    expect(rows[0].Gender).toBe("");
    expect(rows[0].Principal).toBe("");
    expect(rows[0]["Section Head"]).toBe("");
    expect(rows[0]["Assistant Head"]).toBe("");
  });

  it("keeps rows in the order given, one row in, one row out", () => {
    const rows = toSchoolPapersExportRows([
      adminSchoolPaperRow({ id: "s3", schoolName: "Zamora ES" }),
      adminSchoolPaperRow({ id: "s1", schoolName: "Alabel ES" }),
      adminSchoolPaperRow({ id: "s2", schoolName: "Malandag ES" }),
    ]);

    expect(rows.map((row) => row["School Name"])).toEqual([
      "Zamora ES",
      "Alabel ES",
      "Malandag ES",
    ]);
  });

  it("produces an empty array for an empty input", () => {
    expect(toSchoolPapersExportRows([])).toEqual([]);
  });
});
