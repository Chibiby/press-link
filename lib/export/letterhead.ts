import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

/**
 * The same four-logo lockup shown on the sign-in screen (see
 * `components/auth-shell.tsx`) — DepEd MATATAG, Bagong Pilipinas, the
 * division seal, and the ASPAJCCJSI mark — read once per process and reused
 * across every worksheet a builder writes.
 */
const LOGO_FILES = [
  "logo-deped-matatag.png",
  "logo-bagong-pilipinas.png",
  "logo-deped-sarangani.png",
  "aspajccjsi-mark.png",
] as const;

const LOGO_SIZE = 40;
const LOGO_COLUMN_STRIDE = 1.15;

/** Rows the letterhead occupies; a sheet's own content starts after these. */
export const LETTERHEAD_ROWS = 2;

let cachedDataUris: string[] | null = null;

/**
 * Data URIs rather than raw Buffers: ExcelJS's `Image.buffer` type is typed
 * against its own bundled `@types/node`, which conflicts with this project's
 * — `base64` sidesteps the mismatch entirely.
 */
function logoDataUris(): string[] {
  if (!cachedDataUris) {
    cachedDataUris = LOGO_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(process.cwd(), "public", file));
      return `data:image/png;base64,${bytes.toString("base64")}`;
    });
  }
  return cachedDataUris;
}

/**
 * Stamps the logo lockup across the top of a worksheet so a downloaded file
 * carries the same letterhead as the app it came from. Every export builder
 * calls this before writing its own rows, which start at `LETTERHEAD_ROWS + 1`.
 */
export function addLetterhead(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).height = 46;
  sheet.getRow(2).height = 10;

  logoDataUris().forEach((base64, i) => {
    const imageId = workbook.addImage({ base64, extension: "png" });
    sheet.addImage(imageId, {
      tl: { col: i * LOGO_COLUMN_STRIDE, row: 0.05 },
      ext: { width: LOGO_SIZE, height: LOGO_SIZE },
    });
  });
}
