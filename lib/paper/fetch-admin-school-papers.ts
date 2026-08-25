import {
  toAdminSchoolPaperRows,
  type AdminSchoolPaperRow,
  type RawAdminSchoolPaper,
} from "@/lib/paper/admin-papers";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { SupabaseServerClient } from "@/lib/supabase/server";

/**
 * The one query behind /admin/school-papers, and its own export route — so a
 * downloaded workbook can never disagree with the screen it was downloaded
 * from. Takes a client rather than building one, the same split
 * `fetchEventMatrix` and `fetchSchoolFacts` use, because the two callers guard
 * differently: a page redirects to the login screen, a route handler must
 * answer with JSON instead.
 *
 * Paged, not one select — see `fetchAll`'s own doc for why an unbounded read
 * of a table that outgrows PostgREST's row cap is a silent, not a loud,
 * failure. `.order("id")` is a tiebreaker: `schools.name` has no unique
 * constraint (migration 0001), so a tied ORDER BY alone can drop a school
 * between two pages or repeat it.
 */
export async function fetchAdminSchoolPaperRows(
  supabase: SupabaseServerClient
): Promise<AdminSchoolPaperRow[]> {
  const raw = await fetchAll<RawAdminSchoolPaper>("The school paper registry", (from, to) =>
    supabase
      .from("schools")
      .select(
        "id, name, district_id, is_integrated, level, paper_participation, submission_locked_at, districts(name), school_papers(language, level, paper_name, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title))"
      )
      .order("name")
      .order("id")
      .range(from, to)
      .overrideTypes<RawAdminSchoolPaper[]>()
  );

  return toAdminSchoolPaperRows(raw);
}
