import type { SchoolRollupRow } from "@/lib/dashboard/per-school";
import type { PaperParticipation } from "@/lib/paper/gate";
import { paperStatus } from "@/lib/paper/status";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { SupabaseServerClient } from "@/lib/supabase/server";

interface SchoolFactRow {
  id: string;
  name: string;
  district_id: string | null;
  paper_participation: PaperParticipation;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  participants: { count: number }[];
  coaches: { count: number }[];
  entries: { count: number }[];
  school_papers: { count: number }[];
}

export interface SchoolFacts {
  /**
   * Every school that has engaged with the system at all, ranked by the panel. See
   * the union in the loader for what "engaged" means and why it is four tables.
   */
  active: SchoolRollupRow[];
  registeredSchools: number;
  /**
   * School counts keyed by district id — registered, not active. A filtered table
   * needs a filtered denominator, or its footer reads "4 of 332 schools" while its
   * totals cover four. Task 20's districts page reads this too.
   */
  registeredByDistrict: Record<string, number>;
  schoolsWithEntries: number;
  districtsRegistered: number;
  districtsWithEntries: number;
  schoolsLocked: number;
  schoolsOpenWithEntries: number;
  schoolsPaperNotStarted: number;
  schoolsWithLearnersButNoEntry: number;
}

/**
 * One query, ten facts. Each `(count)` is an embedded aggregate, which PostgREST
 * returns as a one-element array — the same shape `/admin/entries` already unwraps for
 * its `school_papers(count)`.
 *
 * The 332 rows are filtered in JavaScript because PostgREST cannot filter or order on
 * an embedded aggregate: `participants(count) > 0` is not expressible as a query. One
 * request for 332 narrow rows is cheaper than the alternatives.
 *
 * ## Why it is paged
 *
 * PostgREST caps a response at `db-max-rows` and reports nothing when it does, so an
 * unbounded read of a table that grows past the cap answers short and clean. Every
 * numerator here is a `rows.filter(...).length`, so a clipped window does not make this
 * page look empty — it makes each of ten facts quietly smaller, and the export route
 * that shares this function files those numbers in a spreadsheet. 332 schools sits
 * under the cap today, so `fetchAll` still costs a single request; what it buys is that
 * the day the roll passes the cap the reads raise instead of shrinking.
 *
 * `.order("id")` is a tiebreaker, not a re-ordering: `schools.name` has no unique
 * constraint, and LIMIT/OFFSET over a tied ORDER BY can put one row in two windows and
 * another in none.
 *
 * `count: "exact"` rides along on the same request, taken from the first page.
 * `registeredSchools` comes from that header total rather than from `rows.length`, so
 * the "of N registered" denominator is answered by Postgres either way.
 *
 * It takes the client rather than building one, because its two callers guard
 * differently: a page redirects to the login screen, a route handler must answer 401
 * with JSON. Sharing the query and not the guard is the point of this module, so there
 * is deliberately no auth here.
 */
export async function fetchSchoolFacts(
  supabase: SupabaseServerClient
): Promise<SchoolFacts> {
  let registered: number | null = null;

  const data = await fetchAll<SchoolFactRow>("The school registry", async (from, to) => {
    const result = await supabase
      .from("schools")
      .select(
        "id, name, district_id, paper_participation, submission_locked_at, districts(name), participants(count), coaches(count), entries(count), school_papers(count)",
        { count: "exact" }
      )
      .order("name")
      .order("id")
      .range(from, to)
      .overrideTypes<SchoolFactRow[]>();

    // The header total is the same on every page, so the first one that carries it
    // wins. Kept out of `fetchAll` on purpose: that helper's contract is rows, and
    // widening it for one caller's count would put a second thing in it to get wrong.
    registered ??= result.count;
    return result;
  });

  const rows = data.map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    districtId: row.district_id,
    districtName: row.districts?.name ?? "",
    learners: row.participants?.[0]?.count ?? 0,
    coaches: row.coaches?.[0]?.count ?? 0,
    entries: row.entries?.[0]?.count ?? 0,
    paperCount: row.school_papers?.[0]?.count ?? 0,
    participation: row.paper_participation,
    lockedAt: row.submission_locked_at,
  }));

  const withEntries = rows.filter((row) => row.entries > 0);

  return {
    // "Engaged" is the union of four tables, not one table as a proxy for the rest.
    // Entries, participants, coaches and school_papers overlap without coinciding:
    // measured against production today, 39 schools are engaged and 2 of them reach
    // that set through school_papers alone. This filter *is* the panel's
    // "N of 332 schools" line — summarisePerSchool() takes `active.length` verbatim
    // and does no filtering of its own — so dropping school_papers here would quietly
    // understate engagement. A paper-only school contributes 0 to all three numeric
    // columns, so no total moves; only the school count does.
    active: rows
      .filter(
        (row) =>
          row.learners > 0 || row.coaches > 0 || row.entries > 0 || row.paperCount > 0
      )
      .map(({ schoolId, schoolName, districtId, districtName, learners, coaches, entries }) => ({
        schoolId,
        schoolName,
        // "" for a school with no district, matching districtName above. A district
        // filter compares against a uuid, so an unassigned school never matches one.
        districtId: districtId ?? "",
        districtName,
        learners,
        coaches,
        entries,
      })),
    registeredSchools: registered ?? rows.length,
    registeredByDistrict: rows.reduce<Record<string, number>>((acc, row) => {
      if (row.districtId) acc[row.districtId] = (acc[row.districtId] ?? 0) + 1;
      return acc;
    }, {}),
    schoolsWithEntries: withEntries.length,
    // A school with no district still counts as registered, so the id is only
    // deduplicated where it exists.
    districtsRegistered: new Set(rows.map((row) => row.districtId).filter(Boolean)).size,
    districtsWithEntries: new Set(withEntries.map((row) => row.districtId).filter(Boolean))
      .size,
    schoolsLocked: rows.filter((row) => row.lockedAt !== null).length,
    // The number buildTimeline() needs: a school still holding the door open on real
    // work. A locked school with no entries does not keep registration open, and an
    // unlocked school with no entries has nothing to submit.
    schoolsOpenWithEntries: rows.filter((row) => row.entries > 0 && row.lockedAt === null)
      .length,
    // paperStatus() is the same derivation /admin/school-papers filters on, so this
    // count and `?status=incomplete` cannot disagree: `paperCount < 1` there is a
    // distinct-language set, and no rows means no languages either way.
    schoolsPaperNotStarted: rows.filter(
      (row) =>
        paperStatus({
          participation: row.participation,
          paperCount: row.paperCount,
          lockedAt: row.lockedAt,
        }) === "incomplete"
    ).length,
    schoolsWithLearnersButNoEntry: rows.filter((row) => row.learners > 0 && row.entries === 0)
      .length,
  };
}
