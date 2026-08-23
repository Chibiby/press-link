import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { DistrictSearch } from "./DistrictSearch";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DISTRICTS_PATH,
  districtEmptyState,
  districtTotalsLabel,
  filterDistrictRows,
  type DistrictFilters,
} from "@/lib/admin/district-filters";
import { summarisePerDistrict } from "@/lib/dashboard/per-district";
import type { RegistryRow } from "@/lib/dashboard/school-registry";

/** The same select the registry runs, minus the columns a rollup cannot use. */
interface DistrictSchoolRow {
  id: string;
  name: string;
  district_id: string;
  is_integrated: boolean;
  participants: { count: number }[];
  coaches: { count: number }[];
  entries: { count: number }[];
}

interface DistrictRow {
  id: string;
  name: string;
}

export default async function AdminDistrictsPage({
  searchParams,
}: {
  // A Promise, and awaited below — that is what a page is handed in this version
  // of Next. `DistrictFilters` rather than a shape declared here, so the page and
  // the filter it hands these to cannot disagree about the param's name, which is
  // a mistake with no symptom other than a control that silently does nothing.
  searchParams: Promise<DistrictFilters>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  const [districtResult, schoolResult] = await Promise.all([
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
    supabase
      .from("schools")
      .select("id, name, district_id, is_integrated, participants(count), coaches(count), entries(count)")
      .overrideTypes<DistrictSchoolRow[]>(),
  ]);

  // summarisePerDistrict reads only districtId and the three counts, but the row type is
  // shared with /admin/schools, so the rest is filled rather than cast away.
  //
  // schoolIdNumber and districtName are empty strings, and that is honest: empty reads as
  // absent. isIntegrated is not, because `false` reads as *answered* — a placeholder there
  // would be a lie that no test could catch, since every school would simply look
  // non-integrated. So this select asks for the real column.
  const rows: RegistryRow[] = (schoolResult.data ?? []).map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    schoolIdNumber: "",
    districtId: row.district_id,
    districtName: "",
    isIntegrated: row.is_integrated,
    learners: row.participants?.[0]?.count ?? 0,
    coaches: row.coaches?.[0]?.count ?? 0,
    entries: row.entries?.[0]?.count ?? 0,
    lockedAt: null,
  }));

  const summary = summarisePerDistrict(districtResult.data ?? [], rows);

  // The searched rows replace only the list. `summary.totals` and
  // `summary.districtsWithEntries` stay off the whole roll, the way
  // /admin/overall-data keeps its division figures off the unsearched set: those
  // are the numbers read out in meetings, and a footer computed from a query would
  // be "the total of what I typed" under a label that says Division. There is no
  // `fetchAll` and no shown-count badge here on purpose — 23 rows in one unpaged
  // select cannot hit PostgREST's cap, so a count framed as protection against
  // truncation would be answering a risk this page does not have.
  const shownRows = filterDistrictRows(summary.rows, params);
  const empty = districtEmptyState(params);

  // Name order is what the table shows, so the leader is named here instead of re-sorting
  // the table — two orderings of the same rows is how two readings of "the top district"
  // get into one page. Off `summary.rows`, not the searched list: the subtitle describes
  // the division, and a leader that changed as someone typed would be a different claim.
  const leader = [...summary.rows].sort(
    (a, b) => b.entries - a.entries || a.districtName.localeCompare(b.districtName)
  )[0];

  return (
    // `group` so the search box below can dim the table through one `data-pending`
    // attribute. Nothing in this subtree uses an unnamed `group-*` variant and
    // every group in `components/ui` is named, so there is nothing here for it to
    // cross-talk with.
    <div className="group space-y-6">
      <PageHeading
        title="Districts"
        badge={`${summary.districtsWithEntries} of ${summary.rows.length} entered`}
        subtitle={
          leader && leader.entries > 0
            ? `${summary.rows.length} districts on the division roll. ${leader.districtName} leads with ${leader.entries} entries.`
            : `${summary.rows.length} districts on the division roll. No entries yet.`
        }
      />

      <DistrictSearch />

      <Card>
        <CardContent>
          {/* Dimmed while the search box's navigation is still rendering on the
              server, so the table reads as catching up rather than as ignoring
              what was typed. Driven by `data-pending` on the box above.

              `overflow-x-auto` because this is eight columns and `Card` is
              `overflow-hidden`: on a phone the trailing Schools link was being
              clipped with no way to reach it. The scroll is on this wrapper, so
              the page body still never moves sideways. */}
          <div className="overflow-x-auto transition-opacity group-has-data-pending:opacity-50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>District</TableHead>
                  <TableHead className="text-right">Schools</TableHead>
                  <TableHead className="text-right">With data</TableHead>
                  <TableHead className="text-right">Entered</TableHead>
                  <TableHead className="text-right">Learners</TableHead>
                  <TableHead className="text-right">Coaches</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownRows.map((row) => (
                  <TableRow key={row.districtId}>
                    <TableCell className="font-medium">{row.districtName}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.schools}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.schoolsWithData}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.schoolsWithEntries}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.learners}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.coaches}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/schools?district=${row.districtId}`}>Schools</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {shownRows.length === 0 && (
                  <TableRow>
                    {/* `whitespace-normal`, because `TableCell` sets
                        `whitespace-nowrap` in its base and this cell quotes back
                        whatever was typed — a pasted line would otherwise stretch
                        the table into a sideways scroll instead of wrapping. */}
                    <TableCell colSpan={8} className="py-10 text-center whitespace-normal">
                      <p className="mx-auto max-w-[60ch] text-sm text-balance break-words text-muted-foreground">
                        {empty.message}
                      </p>
                      {empty.narrowed && (
                        // A way back, on the table itself — where the reader is
                        // looking — and a link is the honest control for it in a
                        // server component. Navigating here empties the search box
                        // too: the box follows the URL, so it clears when the param
                        // goes.
                        <Button asChild size="sm" variant="outline" className="mt-3">
                          <Link href={DISTRICTS_PATH}>Show all districts</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  {/* Always the whole division, never the sum of the rows above —
                      so while a search is narrowing the list the label says which
                      it is, rather than letting a footer be read as a column sum
                      that does not add up. */}
                  <TableCell>{districtTotalsLabel(params, summary.rows.length)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.schools}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.schoolsWithData}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.schoolsWithEntries}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.learners}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.coaches}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.entries}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
