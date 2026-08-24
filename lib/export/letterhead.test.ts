import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { addExportLetterhead } from "./letterhead";

/** A throwaway sheet with `.columns` set, since centering depends on it. */
function letterheadSheet(widths: number[] = [34, 24, 17, 12, 9, 44, 40, 40, 62, 20, 74]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet");
  sheet.columns = widths.map((width) => ({ width }));
  return { workbook, sheet };
}

describe("addExportLetterhead", () => {
  it("returns a row a caller's own content can start writing at, past the block", () => {
    const { workbook, sheet } = letterheadSheet();

    const startRow = addExportLetterhead(workbook, sheet);

    expect(startRow).toBeGreaterThan(1);
    expect(Number.isInteger(startRow)).toBe(true);
  });

  it("adds exactly five images in one call — the lockup plus the four footer logos", () => {
    const { workbook, sheet } = letterheadSheet();

    addExportLetterhead(workbook, sheet);

    expect(sheet.getImages()).toHaveLength(5);
  });

  it("writes the four contact lines with the label bold and the value regular", () => {
    const { workbook, sheet } = letterheadSheet();
    addExportLetterhead(workbook, sheet);

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
    const { workbook, sheet } = letterheadSheet();
    addExportLetterhead(workbook, sheet);

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

  it("marks the whole block, and only the block, as a repeating print title", () => {
    const { workbook, sheet } = letterheadSheet();

    const startRow = addExportLetterhead(workbook, sheet);

    expect(sheet.pageSetup.printTitlesRow).toBe(`1:${startRow - 1}`);
  });

  it("produces a non-negative centering offset for a narrow sheet", () => {
    // overall-data-workbook.ts's shape: 5 narrow columns.
    const { workbook, sheet } = letterheadSheet([40, 24, 12, 12, 12]);

    expect(() => addExportLetterhead(workbook, sheet)).not.toThrow();
    const [lockup] = sheet.getImages();
    expect(lockup.range.tl.col).toBeGreaterThanOrEqual(0);
  });

  it("produces a non-negative centering offset for a wide sheet", () => {
    // entries-workbook.ts's shape: 11 wide columns.
    const { workbook, sheet } = letterheadSheet([8, 32, 22, 34, 12, 12, 10, 30, 8, 34, 20]);

    expect(() => addExportLetterhead(workbook, sheet)).not.toThrow();
    const [lockup] = sheet.getImages();
    expect(lockup.range.tl.col).toBeGreaterThanOrEqual(0);
  });
});
