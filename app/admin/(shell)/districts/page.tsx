import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
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

export default async function AdminDistrictsPage() {
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

  // Name order is what the table shows, so the leader is named here instead of re-sorting
  // the table — two orderings of the same rows is how two readings of "the top district"
  // get into one page.
  const leader = [...summary.rows].sort(
    (a, b) => b.entries - a.entries || a.districtName.localeCompare(b.districtName)
  )[0];

  return (
    <div className="space-y-6">
      <PageHeading
        title="Districts"
        badge={`${summary.districtsWithEntries} of ${summary.rows.length} entered`}
        subtitle={
          leader && leader.entries > 0
            ? `${summary.rows.length} districts on the division roll. ${leader.districtName} leads with ${leader.entries} entries.`
            : `${summary.rows.length} districts on the division roll. No entries yet.`
        }
      />

      <Card>
        <CardContent>
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
              {summary.rows.map((row) => (
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
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Division</TableCell>
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
        </CardContent>
      </Card>
    </div>
  );
}
