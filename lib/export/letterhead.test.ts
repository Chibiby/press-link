import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { addExportFooter, addExportHeader } from "./letterhead";

describe("addExportHeader", () => {
  it("returns a row a caller's own content can start writing at, past the lockup image", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");

    const startRow = addExportHeader(workbook, sheet);

    expect(startRow).toBeGreaterThan(1);
    expect(Number.isInteger(startRow)).toBe(true);
  });

  it("adds exactly one image — the seal-and-titles lockup", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");

    addExportHeader(workbook, sheet);

    expect(sheet.getImages()).toHaveLength(1);
  });
});

describe("addExportFooter", () => {
  function footerSheet() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getRow(1).values = ["a header row a caller already wrote"];
    addExportFooter(workbook, sheet, 1);
    return sheet;
  }

  it("adds all four logos — the three division logos plus Press Link's own mark", () => {
    const sheet = footerSheet();
    expect(sheet.getImages()).toHaveLength(4);
  });

  it("writes the four contact lines with the label bold and the value regular", () => {
    const sheet = footerSheet();

    const lines: { label: string; value: string }[] = [];
    sheet.eachRow((row) => {
      const values = row.values as (string | number | undefined)[];
      // The label/value pair lives a few columns past the logos; find it by scanning
      // for a cell whose text ends in a colon rather than hardcoding a column index,
      // so the assertion survives a future shift in FOOTER_TEXT_COLUMN.
      for (let col = 1; col < values.length; col += 1) {
        const cell = values[col];
        if (typeof cell === "string" && cell.endsWith(":")) {
          lines.push({ label: cell, value: String(values[col + 1] ?? "") });
        }
      }
    });

    expect(lines).toEqual([
      { label: "Address:", value: "Capitol Compound, Maribulan, Alabel, Sarangani Province" },
      { label: "Telephone Nos.:", value: "(083) 508-2039" },
      { label: "Website:", value: "depedsarangani.org" },
      { label: "Email Address:", value: "sarangani@deped.gov.ph" },
    ]);
  });

  it("bolds only the label cell, never the value", () => {
    const sheet = footerSheet();

    let checked = 0;
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string" && cell.value.endsWith(":")) {
          expect(cell.font?.bold).toBe(true);
          const valueCell = row.getCell(cell.fullAddress.col + 1);
          expect(valueCell.font?.bold).not.toBe(true);
          checked += 1;
        }
      });
    });

    expect(checked).toBe(4);
  });
});
