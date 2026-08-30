import { NextResponse } from "next/server";

import { checkAdmin } from "@/app/admin/guard";
import { buildEventSheetWorkbook } from "@/lib/export/judging-workbook";

import { eventFullLabel, loadEventSheet } from "../../../judging-data";

/**
 * The workbook behind the export button on /admin/tabulators/[eventId].
 *
 * Not routed through `judgingWorkbookResponse` like the two index exports: that
 * helper loads the whole event index, which is the thing these two builders take
 * and this one does not. The three steps it shares — gate, load, serialise — are
 * repeated here rather than parameterised into it, because a helper that took
 * either a whole index or one event's sheet would be a helper with two shapes and
 * a branch, which is worse than nine lines twice.
 *
 * What is *not* repeated is the sheet itself. `loadEventSheet` is the same
 * `cache()`d loader the page calls, so a click on the page's own export re-uses
 * the read the page just did and the file cannot disagree with the screen.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> }
): Promise<NextResponse> {
  // checkAdmin() rather than requireAdmin(): a route handler that redirects answers
  // a download click with a login page and a 200, and the browser saves that login
  // screen under an .xlsx name with no sign anything went wrong.
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return check.reason === "unauthenticated"
      ? NextResponse.json({ error: "Not authenticated" }, { status: 401 })
      : NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { eventId } = await params;
  const { row, rows, unidentified, error } = await loadEventSheet(eventId);

  // A failed query must not become a workbook of no contestants. That file would
  // read as an event nobody ranked — a structural absence printed as a measured
  // zero, and worse in a spreadsheet than on screen, because a file carries no error
  // banner and outlives the click that made it (non-negotiable 5).
  if (error) {
    return NextResponse.json(
      { error: `This event's sheet could not be read, so no workbook was built: ${error}` },
      { status: 500 }
    );
  }

  // Distinguished from the error above on purpose: this is the one case where the
  // event genuinely is not there, and `loadEventSheet` only returns a null row
  // without an error when the read succeeded and found nothing.
  if (!row) {
    return NextResponse.json({ error: "This event could not be found." }, { status: 404 });
  }

  const generatedAt = new Date().toISOString().slice(0, 10);
  const buffer = await buildEventSheetWorkbook(
    { row, rows, unidentified },
    generatedAt
  ).xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // The event in the filename, not just the date. A tabulator downloads a dozen
      // of these in an afternoon, and a folder of files differing only by a numeric
      // suffix is a folder nobody can check anything against.
      "Content-Disposition": `attachment; filename="press-link-results-${fileSlug(
        `${row.typeNameEn} ${eventFullLabel(row.level, row.language)}`
      )}-${generatedAt}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * An event's name as a filename fragment: lower case, ASCII, hyphen-separated.
 *
 * Kept deliberately narrow. `Content-Disposition` is a header, and an event name
 * carrying a quote, a comma or a non-Latin character would either break the
 * parameter or arrive as mojibake in the saved filename. Stripping to
 * `[a-z0-9-]` costs a little fidelity and cannot produce either.
 */
function fileSlug(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // An event named entirely outside the Latin alphabet would slug to nothing, and a
  // filename with an empty fragment reads as a bug in the export rather than as a
  // name that could not be transliterated.
  return slug || "event";
}
