import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { checkAdmin } from "@/app/admin/guard";
import type { JudgingExportInput } from "@/lib/export/judging-workbook";

import { loadJudgingEventIndex } from "./judging-data";

/**
 * The shared body of the two adjudication export routes.
 *
 * Both do the same three things — gate the caller, load the index, serialise a
 * workbook — and differ only in which builder they call and what the file is
 * named. Kept in one place for the reason `event-index.ts` gives for building the
 * row once: two handlers deciding separately what to do about an absent catalog is
 * how one of them ends up shipping an empty spreadsheet.
 */
export async function judgingWorkbookResponse({
  build,
  slug,
}: {
  build: (input: JudgingExportInput, generatedAt: string) => XLSX.WorkBook;
  slug: string;
}): Promise<NextResponse> {
  // checkAdmin() rather than requireAdmin(): a route handler that redirects answers
  // a download click with a login page and a 200, and the browser saves that login
  // screen under an .xlsx name with no sign anything went wrong. checkAdmin only
  // reports, which is what a handler needs — see app/admin/guard.ts.
  //
  // A route handler is reachable on its own, so this gate is not a formality even
  // though proxy.ts guards /admin.
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return check.reason === "unauthenticated"
      ? NextResponse.json({ error: "Not authenticated" }, { status: 401 })
      : NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { rows, judges, error } = await loadJudgingEventIndex();

  // A failed catalog query must not become a workbook of no events. That file would
  // read as "the division runs no contests" — a structural absence printed as a
  // measured zero, and worse here than on screen, because a spreadsheet carries no
  // error banner and outlives the click that made it (non-negotiable 5).
  if (error) {
    return NextResponse.json(
      { error: `The event catalog could not be read, so no workbook was built: ${error}` },
      { status: 500 }
    );
  }

  const generatedAt = new Date().toISOString().slice(0, 10);
  const buffer: Buffer = XLSX.write(build({ rows, judges }, generatedAt), {
    type: "buffer",
    bookType: "xlsx",
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="press-link-${slug}-${generatedAt}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
