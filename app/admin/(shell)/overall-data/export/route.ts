import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { summarisePerSchool } from "@/lib/dashboard/per-school";
import { fetchSchoolFacts } from "@/lib/dashboard/school-facts";
import { buildOverallDataWorkbook } from "@/lib/export/overall-data-workbook";
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

  const district = request.nextUrl.searchParams.get("district");
  const facts = await fetchSchoolFacts(supabase);
  const active = district
    ? facts.active.filter((school) => school.districtId === district)
    : facts.active;

  // No row limit: this is the full view the dashboard's truncated panel links to.
  // The denominator narrows with the filter so the sheet's total row cannot claim
  // a division-wide population for a single district's numbers.
  const summary = summarisePerSchool(active, {
    limit: active.length,
    registeredSchools: district
      ? (facts.registeredByDistrict[district] ?? 0)
      : facts.registeredSchools,
  });

  const book = buildOverallDataWorkbook(summary);
  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="press-link-overall-data-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
