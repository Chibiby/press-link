import { NextResponse, type NextRequest } from "next/server";

import {
  eventsExportFilename,
  filterEventRows,
  type EventFilters,
} from "@/lib/admin/event-filters";
import { fetchEventMatrix } from "@/lib/dashboard/fetch-event-matrix";
import { buildEventsMatrixWorkbook } from "@/lib/export/events-matrix-workbook";
import { SEARCH_PARAM } from "@/lib/search/filter-params";
import { createClient } from "@/lib/supabase/server";

type EventExportCategory = "individual" | "group";

function isEventExportCategory(value: string | null): value is EventExportCategory {
  return value === "individual" || value === "group";
}

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

  const requestParams = request.nextUrl.searchParams;

  // Which of the page's two cards this download is for. Required, and checked
  // against the closed set rather than trusted, because this param picks which
  // half of the catalogue is read below — an unrecognised value has no honest
  // table to answer with.
  const category = requestParams.get("category");
  if (!isEventExportCategory(category)) {
    return NextResponse.json(
      { error: 'category must be "individual" or "group"' },
      { status: 400 }
    );
  }

  // Read as `EventFilters` and handed to the page's own filter module, not
  // matched again here. Two implementations of "does this contest match what was
  // typed" is exactly how a workbook comes to disagree with the screen it was
  // downloaded from.
  //
  // `getAll` because `?q=a&q=b` is reachable by hand; the module takes the first,
  // which is the one the search box shows.
  const filters: EventFilters = {
    [SEARCH_PARAM]: requestParams.getAll(SEARCH_PARAM),
  };

  const result = await fetchEventMatrix(supabase);
  if ("error" in result) {
    return NextResponse.json({ error: "The contest catalog could not be loaded" }, { status: 500 });
  }

  const rows = category === "individual" ? result.matrix.individual : result.matrix.group;
  const filtered = filterEventRows(rows, filters);

  const book = buildEventsMatrixWorkbook(
    filtered,
    category === "individual" ? "Individual Events" : "Group Events"
  );
  const buffer = await book.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Says "filtered" and carries the query when one is set, and always carries
      // the category — see `eventsExportFilename` for why. Slugged in that
      // module, which is also what keeps a quote or a newline out of this header.
      "Content-Disposition": `attachment; filename="${eventsExportFilename(category, filters, date)}"`,
      "Cache-Control": "no-store",
    },
  });
}
