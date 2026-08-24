import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

/**
 * Why the header and footer are plain sheet content, not `worksheet.headerFooter`.
 *
 * `exceljs` cannot embed images in Excel's native print header/footer — its own
 * README says so ("Images are not currently supported" for `headerFooter`). And a
 * floating image can only be made to repeat on every printed page via a TOP-anchored
 * "print title row"; there is no bottom equivalent. So there is no way to have a
 * native-header-style image band that repeats on the last page the way it does on
 * the first.
 *
 * The division's letterhead has a header (seal, titles) and a footer (logos,
 * contact info), and the user's explicit call was: show the header only on the
 * sheet's first printed page and the footer only on its last — never attempt to
 * repeat either on every page. That is exactly what plain content does for free:
 * the header is the sheet's first rows, the footer is appended after the last row
 * a builder writes, and Excel paginates them wherever the content happens to land.
 * If a sheet fits on one page, both appear together on it.
 */

/**
 * The seal-and-titles lockup — Republic of the Philippines, Department of
 * Education (blackletter), SOCCSKSARGEN Region, Schools Division of Sarangani —
 * cropped from the division's Word-doc letterhead template. 1987x382px.
 */
const HEADER_LOCKUP_FILE = "export-header-lockup.png";
const HEADER_LOCKUP_WIDTH = 660;
const HEADER_LOCKUP_HEIGHT = 127; // 660 * (382 / 1987), preserving the source aspect ratio.

/**
 * The same four-logo lockup shown on the sign-in screen (see
 * `components/auth-shell.tsx`) — DepEd MATATAG, Bagong Pilipinas, the
 * division seal, and the ASPAJCCJSI mark (Press Link's own icon, per
 * `components/brand/wordmark.tsx`) — read once per process and reused
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

/** Where the footer's contact lines start, once the four logos have cleared. */
const FOOTER_TEXT_COLUMN = 6;

const FOOTER_CONTACT_LINES: readonly [label: string, value: string][] = [
  ["Address:", "Capitol Compound, Maribulan, Alabel, Sarangani Province"],
  ["Telephone Nos.:", "(083) 508-2039"],
  ["Website:", "depedsarangani.org"],
  ["Email Address:", "sarangani@deped.gov.ph"],
];

let cachedHeaderLockupDataUri: string | null = null;
let cachedLogoDataUris: string[] | null = null;

/**
 * Data URIs rather than raw Buffers: ExcelJS's `Image.buffer` type is typed
 * against its own bundled `@types/node`, which conflicts with this project's
 * — `base64` sidesteps the mismatch entirely.
 */
function readAsDataUri(file: string): string {
  const bytes = fs.readFileSync(path.join(process.cwd(), "public", file));
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function headerLockupDataUri(): string {
  if (!cachedHeaderLockupDataUri) {
    cachedHeaderLockupDataUri = readAsDataUri(HEADER_LOCKUP_FILE);
  }
  return cachedHeaderLockupDataUri;
}

function logoDataUris(): string[] {
  if (!cachedLogoDataUris) {
    cachedLogoDataUris = LOGO_FILES.map(readAsDataUri);
  }
  return cachedLogoDataUris;
}

/**
 * Stamps the header block — the national-seal-and-titles lockup — at the very
 * top of a worksheet, as literal rows 1-2 (not a native print header, so it
 * naturally appears only on the sheet's first printed page — see the module
 * doc comment for why).
 *
 * Returns the first row number a caller's own content (its header row, or
 * data) may start writing at.
 */
export function addExportHeader(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet): number {
  const imageId = workbook.addImage({ base64: headerLockupDataUri(), extension: "png" });

  // Row 1 holds the lockup; its height (in points, so *0.75 from the image's
  // pixel height) must clear the image or a builder's own header row would
  // overlap it. Row 2 is a blank spacer, matching the old letterhead's shape.
  sheet.getRow(1).height = 100;
  sheet.getRow(2).height = 10;

  sheet.addImage(imageId, {
    tl: { col: 0.3, row: 0.05 },
    ext: { width: HEADER_LOCKUP_WIDTH, height: HEADER_LOCKUP_HEIGHT },
  });

  return 3;
}

/**
 * Stamps the footer block — the DepEd MATATAG / Bagong Pilipinas / Division of
 * Sarangani / Press Link four-logo row plus the division's contact info — as
 * literal rows appended immediately after a caller's last content row. Because
 * this is plain sheet content and not a native print footer, it naturally
 * lands on whichever page ends up being the sheet's LAST printed page (the
 * same page as the header, if everything fits on one page).
 *
 * `afterRow` is the last row the caller has already written (its last data
 * row, or a totals row) — the footer starts at `afterRow + 1`.
 */
export function addExportFooter(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  afterRow: number
): void {
  const ruleRow = afterRow + 1;
  const ruleWidth = Math.max(sheet.columnCount, 10);
  for (let col = 1; col <= ruleWidth; col += 1) {
    sheet.getCell(ruleRow, col).border = { top: { style: "thin" } };
  }

  const logoRow = ruleRow + 1;
  sheet.getRow(logoRow).height = 46;

  logoDataUris().forEach((base64, i) => {
    const imageId = workbook.addImage({ base64, extension: "png" });
    sheet.addImage(imageId, {
      tl: { col: i * LOGO_COLUMN_STRIDE, row: logoRow - 1 + 0.05 },
      ext: { width: LOGO_SIZE, height: LOGO_SIZE },
    });
  });

  FOOTER_CONTACT_LINES.forEach(([label, value], i) => {
    const row = sheet.getRow(logoRow + i);
    const labelCell = row.getCell(FOOTER_TEXT_COLUMN);
    labelCell.value = label;
    labelCell.font = { bold: true };
    row.getCell(FOOTER_TEXT_COLUMN + 1).value = value;
  });
}
