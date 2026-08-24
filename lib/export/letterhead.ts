import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

/**
 * Why the header and footer are ONE block, stamped at the top of the sheet and
 * marked a repeating print title, rather than a true top header and bottom footer.
 *
 * `exceljs` cannot embed images in Excel's native print header/footer — its own
 * README says so ("Images are not currently supported" for `headerFooter`) — so
 * both pieces have to be plain worksheet content. And Excel's only mechanism for
 * making plain content repeat on every printed page, "Print Titles"
 * (`pageSetup.printTitlesRow`), only ever repeats rows anchored at the TOP of the
 * sheet — there is no bottom equivalent, in Excel itself, not just this library.
 * So a footer that repeats at the true bottom margin of every page is not
 * achievable by any automated means here.
 *
 * The division's letterhead has a header (seal, titles) and a footer (logos,
 * contact info), and every printed page must show both. The only way to make that
 * true is to merge them into one block, place it at the top of the sheet, and mark
 * the whole block a print title — Excel then reprints the whole thing, header and
 * footer content together, at the top of every page.
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

/**
 * Excel's own default column width, in character-width units — the fallback for a
 * `sheet.columns` entry with no explicit `.width`. Every builder in this codebase
 * sets one, but the centering math below has to stay defined even if a future
 * caller doesn't.
 */
const DEFAULT_COLUMN_WIDTH_CHARS = 8.43;

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
 * Converts an Excel character-width column width to pixels, using Microsoft's own
 * documented approximation for the default Calibri-11 font (MDW = 7):
 * `pixels ≈ round(charWidth * 7 + 5)`.
 */
function columnWidthToPixels(charWidth: number): number {
  return Math.round(charWidth * 7 + 5);
}

/**
 * Where the header lockup's left edge must anchor, as a fractional column offset,
 * for the image to land centered against the sheet's actual total column width.
 *
 * Column widths are in character-width units, not pixels, so this walks
 * `sheet.columns` (set by the caller before this runs — see the export's doc
 * comment) converting each to pixels and summing them for the sheet's total
 * content width, then walks again accumulating until the centered left-edge pixel
 * offset falls inside a column; the remainder becomes the fractional part of that
 * column's index — the same fractional-column-anchor approach the four footer
 * logos below use via `LOGO_COLUMN_STRIDE`.
 *
 * A sheet narrower than the image (a very narrow sheet) clamps to `0` — the
 * image's left edge at the sheet's own left edge — rather than a negative offset.
 */
function headerLockupColumnOffset(sheet: ExcelJS.Worksheet): number {
  const widthsPx = (sheet.columns ?? []).map((column) =>
    columnWidthToPixels(column.width ?? DEFAULT_COLUMN_WIDTH_CHARS)
  );
  const totalWidthPx = widthsPx.reduce((sum, width) => sum + width, 0);
  const leftEdgePx = Math.max(0, (totalWidthPx - HEADER_LOCKUP_WIDTH) / 2);

  let accumulatedPx = 0;
  for (let i = 0; i < widthsPx.length; i += 1) {
    const columnWidthPx = widthsPx[i];
    if (accumulatedPx + columnWidthPx > leftEdgePx) {
      return i + (leftEdgePx - accumulatedPx) / columnWidthPx;
    }
    accumulatedPx += columnWidthPx;
  }

  // leftEdgePx falls at or beyond the last column (e.g. no columns set, or a sheet
  // exactly as wide as the image) — anchor at the sheet's start rather than off
  // the edge of its content.
  return 0;
}

/**
 * Stamps the combined header+footer letterhead block at the top of a worksheet
 * and marks it as a repeating print title, so it appears at the top of EVERY
 * printed page — see the module doc comment for why this is one merged block
 * instead of a true top header / bottom footer: Excel has no mechanism to repeat
 * content at the bottom of every page, only the top.
 *
 * MUST be called after `sheet.columns` has been set (it centers the header image
 * against the sheet's actual total column width) — callers need to order their
 * `sheet.columns = ...` assignment before this call.
 *
 * Returns the first row number a caller's own content (its header row, or data)
 * may start writing at.
 */
export function addExportLetterhead(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet): number {
  const imageRow = 1;
  const spacerRow = 2;
  const ruleRow = 3;
  const logoRow = 4;

  // The image row's height (in points) must clear the lockup image or a builder's
  // own header row would overlap it; the spacer row matches the old letterhead's
  // shape between the seal and the rule below it.
  sheet.getRow(imageRow).height = 100;
  sheet.getRow(spacerRow).height = 10;

  const lockupImageId = workbook.addImage({ base64: headerLockupDataUri(), extension: "png" });
  sheet.addImage(lockupImageId, {
    tl: { col: headerLockupColumnOffset(sheet), row: imageRow - 1 + 0.05 },
    ext: { width: HEADER_LOCKUP_WIDTH, height: HEADER_LOCKUP_HEIGHT },
  });

  const ruleWidth = Math.max(sheet.columnCount, 10);
  for (let col = 1; col <= ruleWidth; col += 1) {
    sheet.getCell(ruleRow, col).border = { top: { style: "thin" } };
  }

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

  const lastBlockRow = logoRow + FOOTER_CONTACT_LINES.length - 1;

  // The whole block, top to bottom (image, rule, logos + contact lines), repeats
  // at the top of every printed page — the only way Excel can be made to show
  // both the header and the footer content on every page, not just the first
  // or the last. See the module doc comment.
  sheet.pageSetup.printTitlesRow = `1:${lastBlockRow}`;

  return lastBlockRow + 1;
}
