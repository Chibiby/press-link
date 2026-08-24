import { NextResponse, type NextRequest } from "next/server";

import { buildSchoolRegistryWorkbook } from "@/lib/export/school-registry-workbook";
import {
  categoryCountsBySchool,
  schoolRegistryFiltersFromParams,
  schoolRegistryExportFilename,
  summariseSchoolRegistry,
  toRegistryRows,
  type RawRegistryEntry,
  type RawRegistrySchool,
} from "@/lib/schools/school-registry-filters";
import { fetchAll, LoadFailure } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Inline, not requireAdmin(): a route handler that redirects answers a download
  // click with a login page and a 200 — the browser follows the redirect and saves
  // the login screen under an .xlsx name, with no sign anything went wrong. Same
  // shape as app/admin/(shell)/overall-data/export/route.ts, deliberately.
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

  // Read as `SchoolRegistryFilters` off `request.nextUrl.searchParams`, the same
  // keys the page's own filter bar writes, so the file cannot answer a different
  // question from the screen it was taken from.
  const filters = schoolRegistryFiltersFromParams(request.nextUrl.searchParams);

  // Two paged reads, both wrapped in the one try/catch: schools for the roster and
  // its whole-roster counts, entries for the per-category learner/coach counts the
  // export table needs. Two reads means two chances to run past the row cap, and
  // failing either one has to fail the whole request rather than build a workbook
  // whose category columns silently disagree with its own totals.
  let schoolRows: RawRegistrySchool[];
  let entryRows: RawRegistryEntry[];
  try {
    [schoolRows, entryRows] = await Promise.all([
      fetchAll<RawRegistrySchool>("The school registry", (from, to) =>
        supabase
          .from("schools")
          .select(
            "id, name, school_id_number, district_id, is_integrated, submission_locked_at, districts(name), participants(count), coaches(count), entries(count)"
          )
          .order("name")
          .order("id")
          .range(from, to)
          .overrideTypes<RawRegistrySchool[]>()
      ),
      fetchAll<RawRegistryEntry>("Entries", (from, to) =>
        supabase
          .from("entries")
          .select(
            "school_id, events(category), entry_participants(participants(id)), entry_coaches(coaches(id))"
          )
          .order("id")
          .range(from, to)
          .overrideTypes<RawRegistryEntry[]>()
      ),
    ]);
  } catch (failure) {
    if (!(failure instanceof LoadFailure)) throw failure;
    return NextResponse.json({ error: "Could not load the school registry" }, { status: 500 });
  }

  const rows = toRegistryRows(schoolRows, categoryCountsBySchool(entryRows));
  // The exact function the page calls, so this file can't answer a different
  // question from the screen it came from.
  const summary = summariseSchoolRegistry(rows, filters);

  const book = buildSchoolRegistryWorkbook(summary);
  const buffer = await book.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${schoolRegistryExportFilename(filters, date)}"`,
      "Cache-Control": "no-store",
    },
  });
}
