import { NextResponse, type NextRequest } from "next/server";

import { buildSchoolPapersWorkbook } from "@/lib/export/school-papers-workbook";
import { fetchAdminSchoolPaperRows } from "@/lib/paper/fetch-admin-school-papers";
import {
  eligibleSchoolPaperRows,
  filterSchoolPaperListRows,
  schoolPapersExportFilename,
  type SchoolPaperListFilters,
} from "@/lib/paper/school-paper-filters";
import { SEARCH_PARAM } from "@/lib/search/filter-params";
import { LoadFailure } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Inline, not requireAdmin(): a route handler that redirects answers a download
  // click with a login page and a 200 — the browser follows the redirect and saves
  // the login screen under an .xlsx name, with no sign anything went wrong. Same
  // shape as overall-data/export/route.ts, deliberately.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Read as `SchoolPaperListFilters` and handed to the page's own filter module,
  // not matched again here. Two implementations of "does this school match what
  // was typed" is exactly how a workbook comes to disagree with the screen it was
  // downloaded from.
  //
  // `getAll` because `?q=a&q=b` is reachable by hand; the module takes the first,
  // which is the one the search box shows.
  const requestParams = request.nextUrl.searchParams;
  const filters: SchoolPaperListFilters = {
    [SEARCH_PARAM]: requestParams.getAll(SEARCH_PARAM),
    district: requestParams.get("district") ?? undefined,
    school: requestParams.get("school") ?? undefined,
    status: requestParams.get("status") ?? undefined,
    lock: requestParams.get("lock") ?? undefined,
    language: requestParams.get("language") ?? undefined,
  };

  // `fetchAdminSchoolPaperRows` pages its read and raises rather than answering
  // short — see its own doc. Caught here so a read that could not finish leaves
  // the admin with a 500 and no file, rather than a workbook quietly missing
  // schools; an unhandled raise would answer a download click with an HTML error
  // page saved under an .xlsx name, the same failure this route already guards
  // against for the login redirect.
  let allRows;
  try {
    allRows = await fetchAdminSchoolPaperRows(supabase);
  } catch (failure) {
    if (!(failure instanceof LoadFailure)) throw failure;
    return NextResponse.json({ error: "Could not load the school paper registry" }, { status: 500 });
  }

  // The same two-step base-rule-then-filters the page itself applies: a school
  // with nothing filed drops out before either the dropdowns or the search box
  // run, so a downloaded workbook cannot list a school the screen never showed.
  const eligibleRows = eligibleSchoolPaperRows(allRows);
  const rows = filterSchoolPaperListRows(eligibleRows, filters);

  const book = buildSchoolPapersWorkbook(rows);
  const buffer = await book.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Says "filtered" and carries the query when one is set, so a sheet of three
      // schools is not filed or forwarded as the division's. Slugged in the module,
      // which is also what keeps a quote or a newline out of this header.
      "Content-Disposition": `attachment; filename="${schoolPapersExportFilename(filters, date)}"`,
      "Cache-Control": "no-store",
    },
  });
}
