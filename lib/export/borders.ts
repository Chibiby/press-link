import type ExcelJS from "exceljs";

const THIN = { style: "thin" } as const;

/**
 * A full thin border, all four sides — distinct from the footer's top-only
 * rule row in `letterhead.ts`, which is a deliberate visual divider and not
 * a data table border.
 */
const FULL_BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/**
 * Applies a full thin border to every cell in `rowNumber`, columns 1 through
 * `columnCount` — the shared shape every builder's data table (header row and
 * data rows alike) uses, so the border loop isn't repeated in each builder.
 */
export function borderRow(sheet: ExcelJS.Worksheet, rowNumber: number, columnCount: number): void {
  const row = sheet.getRow(rowNumber);
  for (let col = 1; col <= columnCount; col += 1) {
    row.getCell(col).border = FULL_BORDER;
  }
}
