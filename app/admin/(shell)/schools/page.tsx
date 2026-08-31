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
import { registryRowTotal, SCHOOL_STATUS_LABEL } from "@/lib/dashboard/school-registry";
import {
  applyQualifierCounts,
  categoryCountsBySchool,
  individualCountMode,
  INDIVIDUAL_COLUMN_NOTE,
  qualifierCountsBySchool,
  schoolRegistryEmptyState,
  schoolRegistryStatus,
  summariseSchoolRegistry,
  toRegistryRows,
  type QualifierCounts,
  type RawRegistryEntry,
  type RawRegistryQualifier,
  type RawRegistryQualifierCoach,
  type RawRegistrySchool,
  type SchoolRegistryFilters,
} from "@/lib/schools/school-registry-filters";
import { fetchAll } from "@/lib/supabase/fetch-all";

import { SchoolActions } from "./SchoolActions";
import { SchoolRegistryFilter } from "./SchoolRegistryFilter";

interface DistrictRow {
  id: string;
  name: string;
}

export default async function AdminSchoolsPage({
  searchParams,
}: {
  // Next 16: a Promise. Awaiting it makes the page dynamic, which is also why the client
  // filter's useSearchParams needs no Suspense boundary — same as /admin/overall-data.
  //
  // `SchoolRegistryFilters` rather than a shape declared here: the page and the filter
  // it hands these to cannot then disagree about a param's name, which is a mistake
  // with no symptom other than a control that silently does nothing.
  searchParams: Promise<SchoolRegistryFilters>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  const [schoolRows, districtResult, entryRows] = await Promise.all([
    // Paged, not one select: PostgREST caps a response at `db-max-rows` and says
    // nothing, so an unbounded read would quietly shorten the division roll — and this
    // table's footer sums the rows it got, so the learner, coach and entry totals
    // would be wrong too, not merely incomplete. 332 schools today, so this is
    // prophylactic; the `.order("id")` is not, because `schools.name` carries no
    // unique constraint (migration 0001) and ties reshuffle between page requests.
    fetchAll<RawRegistrySchool>("The school registry", (from, to) =>
      supabase
        .from("schools")
        .select(
          "id, name, school_id_number, district_id, is_integrated, submission_locked_at, districts(name), participants(count), coaches(count), entries(count)"
        )
        .order("districts(name)")
        .order("id")
        .range(from, to)
        .overrideTypes<RawRegistrySchool[]>()
    ),
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
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

  const districts = districtResult.data ?? [];
  const mode = individualCountMode(params);

  // Read only when the table is actually showing round-2 figures. `round2_qualifiers`
  // and the coach links behind it are two more paged reads, and there is no reason to
  // pay for them on every load of a page that usually counts everybody entered.
  //
  // Individual by construction: the two-stage rounds cover individual events only
  // (non-negotiable 6), which is why this narrows the two individual columns and the
  // group ones are left exactly as they were.
  let qualifierCounts = new Map<string, QualifierCounts>();
  if (mode === "qualifiers") {
    const qualifierRows = await fetchAll<RawRegistryQualifier>("Round 2 qualifiers", (from, to) =>
      supabase
        .from("round2_qualifiers")
        .select("participant_id, entry_id, entries(school_id)")
        .order("entry_id")
        .order("participant_id")
        .range(from, to)
        .overrideTypes<RawRegistryQualifier[]>()
    );

    const entryIds = [...new Set(qualifierRows.map((row) => row.entry_id))];
    // Only the entries that have a qualifier on them. The division's whole
    // `entry_coaches` table is an order of magnitude larger and every extra row would
    // be discarded by `qualifierCountsBySchool` anyway.
    const coachRows = entryIds.length
      ? await fetchAll<RawRegistryQualifierCoach>("Qualifying entries' coaches", (from, to) =>
          supabase
            .from("entry_coaches")
            .select("entry_id, coach_id, participant_id")
            .in("entry_id", entryIds)
            .order("entry_id")
            .order("coach_id")
            .range(from, to)
            .overrideTypes<RawRegistryQualifierCoach[]>()
        )
      : [];

    qualifierCounts = qualifierCountsBySchool(qualifierRows, coachRows);
  }

  // Every part of this now lives in `lib/schools/school-registry-filters.ts`, tested
  // there: the row mapper, the district and status filters plus the search box, and
  // the sentence to print when nothing survives.
  const allRows = toRegistryRows(schoolRows, categoryCountsBySchool(entryRows));
  const rows = mode === "qualifiers" ? applyQualifierCounts(allRows, qualifierCounts) : allRows;
  const status = schoolRegistryStatus(params);
  const districtId = params.district ?? null;
  const summary = summariseSchoolRegistry(rows, params);
  const empty = schoolRegistryEmptyState(params);

  const districtName = districtId
    ? (districts.find((row) => row.id === districtId)?.name ?? "Unknown district")
    : null;

  return (
    <div className="group space-y-6">
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

      {/* Dimmed while the filter bar's navigation is still rendering on the server,
          so the table reads as catching up rather than as ignoring what was typed.
          Driven by `data-pending` on the bar above. */}
      <Card className="transition-opacity group-has-data-pending:opacity-50">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead>District</TableHead>
                {/* The individual pair is titled, not renamed: the column stays where
                    a reader last saw it, and the tooltip says which population it is
                    counting now. The group pair carries no title because it never
                    changes — there is no second round to qualify for in a team
                    contest. */}
                <TableHead className="text-right" title={INDIVIDUAL_COLUMN_NOTE[mode]}>
                  {mode === "qualifiers" ? "R2 Learners" : "Ind. Learners"}
                </TableHead>
                <TableHead className="text-right" title={INDIVIDUAL_COLUMN_NOTE[mode]}>
                  {mode === "qualifiers" ? "R2 Coaches" : "Ind. Coaches"}
                </TableHead>
                <TableHead className="text-right">Grp. Learners</TableHead>
                <TableHead className="text-right">Grp. Coaches</TableHead>
                <TableHead
                  className="text-right"
                  title="The four columns to the left, added. Somebody who competes individually and is also on a team is counted in each."
                >
                  Total
                </TableHead>
                {/* No label. The column is one icon button per row, and a heading
                    over it would be read as a data column that happens to be empty. */}
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.rows.length === 0 ? (
                <TableRow>
                  {/* `whitespace-normal`, because `TableCell` sets `whitespace-nowrap`
                      in its base and this cell quotes back whatever was typed — a
                      pasted line would otherwise stretch the table into a sideways
                      scroll instead of wrapping. */}
                  <TableCell colSpan={8} className="py-8 text-center whitespace-normal">
                    <p className="mx-auto max-w-[60ch] text-sm text-balance break-words text-muted-foreground">
                      {empty.message}
                    </p>
                    {empty.narrowed ? (
                      // A way back, on the table itself. The Clear button in the bar
                      // above also covers this — `SEARCH_PARAM` is in its
                      // `FILTER_KEYS` — but an empty table is where the reader is
                      // looking, and a link is the honest control for it in a server
                      // component. Navigating here empties the search box too: the
                      // box follows the URL, so it clears when the param goes.
                      //
                      // `?status=all`, not a bare path: the default filter is now
                      // "has entries", so a bare `/admin/schools` would not actually
                      // show every school — the promise this link makes.
                      <Button asChild size="sm" variant="outline" className="mt-3">
                        <Link href="/admin/schools?status=all">Show all schools</Link>
                      </Button>
                    ) : null}
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
                    <TableCell className="text-right tabular-nums">
                      {row.individualLearners}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.individualCoaches}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.groupLearners}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.groupCoaches}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {registryRowTotal(row)}
                    </TableCell>
                    <TableCell className="text-right">
                      <SchoolActions schoolId={row.schoolId} schoolName={row.schoolName} />
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
                    {summary.totals.individualLearners}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.individualCoaches}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.groupLearners}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.groupCoaches}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {summary.totals.delegates}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
