import { NextResponse, type NextRequest } from "next/server";

import {
  filterOverallDataRows,
  overallDataExportFilename,
  type OverallDataFilters,
} from "@/lib/admin/overall-data-filters";
import { summarisePerSchool } from "@/lib/dashboard/per-school";
import { fetchSchoolFacts } from "@/lib/dashboard/school-facts";
import { buildOverallDataWorkbook } from "@/lib/export/overall-data-workbook";
import { SEARCH_PARAM } from "@/lib/search/filter-params";
import { LoadFailure } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Inline, not requireAdmin(): a route handler that redirects answers a download
  // click with a login page and a 200 — the browser follows the redirect and saves
  // the login screen under an .xlsx name, with no sign anything went wrong. Same
  // shape as app/admin/export/route.ts, deliberately.
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

  // Read as `OverallDataFilters` and handed to the page's own filter module, not
  // matched again here. Two implementations of "does this school match what was
  // typed" is exactly how a workbook comes to disagree with the screen it was
  // downloaded from — one of them gains a trimmed query or a case fold and the other
  // does not, and nobody finds out until an officer compares them in a meeting.
  //
  // `getAll` because `?q=a&q=b` is reachable by hand; the module takes the first,
  // which is the one the search box shows.
  const requestParams = request.nextUrl.searchParams;
  const filters: OverallDataFilters = {
    [SEARCH_PARAM]: requestParams.getAll(SEARCH_PARAM),
    district: requestParams.get("district") ?? undefined,
  };
  const district = filters.district ?? null;

  // `fetchSchoolFacts` pages its read and raises rather than answering short — see the
  // comment there. Caught here so a read that could not finish leaves the officer with
  // a 500 and no file, rather than a workbook whose totals are quietly missing schools;
  // an unhandled raise would answer a download click with an HTML error page saved
  // under an .xlsx name, which is the same failure this route already guards against
  // for the login redirect.
  let facts;
  try {
    facts = await fetchSchoolFacts(supabase);
  } catch (failure) {
    if (!(failure instanceof LoadFailure)) throw failure;
    return NextResponse.json({ error: "Could not load the school registry" }, { status: 500 });
  }

  const active = district
    ? facts.active.filter((school) => school.districtId === district)
    : facts.active;

  // No row limit: this is the full view the dashboard's truncated panel links to.
  // The denominator narrows with the district filter so the sheet's total row cannot
  // claim a division-wide population for a single district's numbers.
  //
  // Summarised before the search is applied, for the same reason the page does it in
  // that order: `summarisePerSchool` totals whatever array it is given, and the sheet
  // labels that row DIVISION TOTAL. A searched array would put the sum of one typed
  // word under that label, in a file that outlives the URL it came from.
  const summary = summarisePerSchool(active, {
    limit: active.length,
    registeredSchools: district
      ? (facts.registeredByDistrict[district] ?? 0)
      : facts.registeredSchools,
  });

  // Rows swapped, every figure kept — the same composition as the page, so the sheet
  // lists what the screen lists while its total row stays the whole selection's. That
  // row's own District cell reads "N of M schools", which is what tells a reader the
  // total is not the sum of the rows above it.
  const book = buildOverallDataWorkbook({
    ...summary,
    rows: filterOverallDataRows(summary.rows, filters),
  });
  const buffer = await book.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Says "filtered" and carries the query when one is set, so a sheet of three
      // schools is not filed or forwarded as the division's. Slugged in the module,
      // which is also what keeps a quote or a newline out of this header.
      "Content-Disposition": `attachment; filename="${overallDataExportFilename(filters, date)}"`,
      "Cache-Control": "no-store",
    },
  });
}
