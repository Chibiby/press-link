import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { addExportFooter, addExportHeader } from "./letterhead";

/** A throwaway sheet with `.columns` set, since centering depends on it. */
function headerSheet(widths: number[] = [34, 24, 17, 12, 9, 44, 40, 40, 62, 20, 74]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet");
  sheet.columns = widths.map((width) => ({ width }));
  return { workbook, sheet };
}

describe("addExportHeader", () => {
  it("returns a row a caller's own content can start writing at, past the lockup image", () => {
    const { workbook, sheet } = headerSheet();

    const startRow = addExportHeader(workbook, sheet);

    expect(startRow).toBeGreaterThan(1);
    expect(Number.isInteger(startRow)).toBe(true);
  });

  it("adds exactly one image — the seal-and-titles lockup", () => {
    const { workbook, sheet } = headerSheet();

    addExportHeader(workbook, sheet);

    expect(sheet.getImages()).toHaveLength(1);
  });

  it("does not mark anything as a repeating print title", () => {
    // The reversal this task exists for: the header is literal rows 1-2, not a
    // repeating band, so it shows only on the sheet's first printed page.
    const { workbook, sheet } = headerSheet();

    addExportHeader(workbook, sheet);

    expect(sheet.pageSetup.printTitlesRow).toBeUndefined();
  });

  it("produces a non-negative centering offset for a narrow sheet", () => {
    // overall-data-workbook.ts's shape: 5 narrow columns.
    const { workbook, sheet } = headerSheet([40, 24, 12, 12, 12]);

    expect(() => addExportHeader(workbook, sheet)).not.toThrow();
    const [lockup] = sheet.getImages();
    expect(lockup.range.tl.col).toBeGreaterThanOrEqual(0);
  });

  it("produces a non-negative centering offset for a wide sheet", () => {
    // entries-workbook.ts's shape: 11 wide columns.
    const { workbook, sheet } = headerSheet([8, 32, 22, 34, 12, 12, 10, 30, 8, 34, 20]);

    expect(() => addExportHeader(workbook, sheet)).not.toThrow();
    const [lockup] = sheet.getImages();
    expect(lockup.range.tl.col).toBeGreaterThanOrEqual(0);
  });

  it("centers the lockup against the sheet's actual total column width, not a fixed offset", () => {
    // A sheet twice as wide should push the lockup's left edge out roughly twice as
    // far from the origin — proving the offset tracks the sheet's own width rather
    // than a constant like the pre-centering version's `col: 0.3`.
    const narrow = headerSheet([40, 24, 12, 12, 12]);
    addExportHeader(narrow.workbook, narrow.sheet);
    const [narrowLockup] = narrow.sheet.getImages();

    const wide = headerSheet([80, 48, 24, 24, 24]);
    addExportHeader(wide.workbook, wide.sheet);
    const [wideLockup] = wide.sheet.getImages();

    expect(wideLockup.range.tl.col).toBeGreaterThan(narrowLockup.range.tl.col);
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

  it("starts at afterRow + 1, not a fixed row", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getRow(1).values = ["row 1"];
    sheet.getRow(2).values = ["row 2"];
    sheet.getRow(3).values = ["row 3"];

    addExportFooter(workbook, sheet, 3);

    const [lockup] = sheet.getImages();
    // The rule row is row 4 (afterRow + 1); the logo row, which the image anchors
    // to, is the row after that.
    expect(lockup.range.tl.row).toBeCloseTo(4, 0);
  });
});
