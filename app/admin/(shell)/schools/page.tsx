import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Badge } from "@/components/ui/badge";
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
  isSchoolStatus,
  SCHOOL_STATUS_LABEL,
  summariseRegistry,
  type RegistryRow,
} from "@/lib/dashboard/school-registry";

import { SchoolRegistryFilter } from "./SchoolRegistryFilter";

const DATE = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Manila",
});

interface RegistrySchoolRow {
  id: string;
  name: string;
  school_id_number: string;
  district_id: string;
  is_integrated: boolean;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  participants: { count: number }[];
  coaches: { count: number }[];
  entries: { count: number }[];
}

interface DistrictRow {
  id: string;
  name: string;
}

export default async function AdminSchoolsPage({
  searchParams,
}: {
  // Next 16: a Promise. Awaiting it makes the page dynamic, which is also why the client
  // filter's useSearchParams needs no Suspense boundary — same as /admin/overall-data.
  searchParams: Promise<{ district?: string; status?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  const [schoolResult, districtResult] = await Promise.all([
    supabase
      .from("schools")
      .select(
        "id, name, school_id_number, district_id, is_integrated, submission_locked_at, districts(name), participants(count), coaches(count), entries(count)"
      )
      .order("name")
      .overrideTypes<RegistrySchoolRow[]>(),
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
  ]);

  const districts = districtResult.data ?? [];

  const rows: RegistryRow[] = (schoolResult.data ?? []).map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    schoolIdNumber: row.school_id_number,
    districtId: row.district_id,
    districtName: row.districts?.name ?? "",
    isIntegrated: row.is_integrated,
    learners: row.participants?.[0]?.count ?? 0,
    coaches: row.coaches?.[0]?.count ?? 0,
    entries: row.entries?.[0]?.count ?? 0,
    lockedAt: row.submission_locked_at,
  }));

  // A junk ?status= falls back to "all" rather than showing an empty table.
  const status = isSchoolStatus(params.status) ? params.status : "all";
  const districtId = params.district ?? null;
  const summary = summariseRegistry(rows, { status, districtId });

  const districtName = districtId
    ? (districts.find((row) => row.id === districtId)?.name ?? "Unknown district")
    : null;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Schools"
        badge={districtName ?? undefined}
        subtitle={
          <>
            {summary.shown} of {summary.registered}{" "}
            {districtName ? `schools in ${districtName}` : "schools on the division roll"}
            {status === "all" ? "" : ` — ${SCHOOL_STATUS_LABEL[status].toLowerCase()}`}.
          </>
        }
      />

      <SchoolRegistryFilter districts={districts} />

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead>District</TableHead>
                <TableHead className="text-right">Learners</TableHead>
                <TableHead className="text-right">Coaches</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No school matches this filter.
                  </TableCell>
                </TableRow>
              ) : (
                summary.rows.map((row) => (
                  <TableRow key={row.schoolId}>
                    <TableCell>
                      <p className="font-medium">{row.schoolName}</p>
                      {/* The id number and the level marker share the second line: the
                          registry is where an officer checks what a school *is*, and an
                          integrated school has to be findable without opening it. */}
                      <div className="flex items-center gap-2">
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {row.schoolIdNumber}
                        </p>
                        {row.isIntegrated ? (
                          <Badge
                            variant="outline"
                            title="Runs elementary and secondary — two papers per language"
                          >
                            Integrated
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.districtName || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.learners}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.coaches}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                    <TableCell>
                      {/* Three states, in the order an officer cares about them: nothing
                          started, submission closed, still open. */}
                      {row.learners === 0 && row.coaches === 0 && row.entries === 0 ? (
                        <Badge variant="outline">Nothing on record</Badge>
                      ) : row.lockedAt ? (
                        <Badge variant="secondary">
                          Locked {DATE.format(new Date(row.lockedAt))}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Open</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/summary?school=${row.schoolId}`}>Summary</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {summary.rows.length > 0 ? (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>
                    {summary.shown} {summary.shown === 1 ? "school" : "schools"} shown
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
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
