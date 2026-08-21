import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { PerSchoolTable } from "@/components/dashboard/PerSchoolTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { countByEventType, summarisePerEvent } from "@/lib/dashboard/per-event";
import { summarisePerSchool } from "@/lib/dashboard/per-school";
import { fetchSchoolFacts } from "@/lib/dashboard/school-facts";

import { OverallDataFilter } from "./OverallDataFilter";

const SHARE = new Intl.NumberFormat("en-PH", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** One entry, reduced to the two columns this page groups by. */
interface EntryTypeRow {
  id: string;
  schools: { district_id: string } | null;
  events: { event_type_id: string; event_types: { name_en: string } | null } | null;
}

interface DistrictRow {
  id: string;
  name: string;
}

export default async function OverallDataPage({
  searchParams,
}: {
  // Next 16: a Promise, and awaiting it is what makes this page dynamic — which is
  // also why the client filter needs no Suspense boundary around useSearchParams.
  searchParams: Promise<{ district?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { district } = await searchParams;

  const [facts, districtResult, entryResult, typeCount] = await Promise.all([
    fetchSchoolFacts(supabase),
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
    supabase
      .from("entries")
      .select("id, schools(district_id), events(event_type_id, event_types(name_en))")
      .overrideTypes<EntryTypeRow[]>(),
    supabase.from("event_types").select("*", { count: "exact", head: true }),
  ]);

  const districts = districtResult.data ?? [];
  const districtName = district
    ? (districts.find((row) => row.id === district)?.name ?? "Unknown district")
    : null;

  const activeSchools = district
    ? facts.active.filter((school) => school.districtId === district)
    : facts.active;

  const perSchool = summarisePerSchool(activeSchools, {
    limit: activeSchools.length,
    registeredSchools: district
      ? (facts.registeredByDistrict[district] ?? 0)
      : facts.registeredSchools,
  });

  const typeRows = (entryResult.data ?? [])
    .filter((row) => (district ? row.schools?.district_id === district : true))
    .map((row) => ({
      typeId: row.events?.event_type_id ?? "",
      typeName: row.events?.event_types?.name_en ?? "Unknown type",
    }))
    .filter((row) => row.typeId !== "");

  const perEvent = summarisePerEvent(countByEventType(typeRows), {
    // Every contested type gets its own row here — the top-8-plus-Other fold is a
    // donut-legibility concession, and a table has no such limit.
    topN: Number.MAX_SAFE_INTEGER,
    typesTotal: typeCount.count ?? 0,
  });

  const withoutData = perSchool.registeredSchools - perSchool.activeSchools;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Overall Data"
        badge={districtName ?? undefined}
        subtitle={
          districtName
            ? `Every school in ${districtName} that has registered a learner, a coach or an entry, and the events they entered.`
            : "Every school that has registered a learner, a coach or an entry, and the events they entered. Nothing on this page is truncated."
        }
      />

      <OverallDataFilter districts={districts} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schools with data</CardTitle>
          <CardDescription>
            {perSchool.activeSchools === 0
              ? "No school in this selection has registered anything yet."
              : `All ${perSchool.activeSchools}, biggest first.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PerSchoolTable summary={perSchool} />
          {withoutData > 0 ? (
            <p className="text-xs text-muted-foreground">
              <Link
                href={`/admin/schools?status=no-data${district ? `&district=${district}` : ""}`}
                className="underline underline-offset-4"
              >
                {withoutData} of the {perSchool.registeredSchools} registered schools
              </Link>{" "}
              have no learners, coaches or entries yet, so they have no row above. They are
              still counted in the division total&apos;s denominator.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entries by event type</CardTitle>
          <CardDescription>
            {perEvent.typesWithEntries} of {perEvent.typesTotal} event types have at least
            one entry. The dashboard donut shows the top eight of these and folds the rest
            into &ldquo;Other&rdquo;; this table folds nothing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {perEvent.slices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No entries in this selection yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              {/* No colour swatches in this table, on purpose: summarisePerEvent
                  assigns eight chart tokens by rank and wraps past the eighth, so
                  beyond the donut's top eight a swatch would repeat a hue and
                  imply two types are the same series. The donut's legend is where
                  colour carries meaning; here the numbers do. */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event type</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perEvent.slices.map((slice) => (
                    <TableRow key={slice.key}>
                      <TableCell className="font-medium text-foreground">
                        {slice.label}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {slice.entries}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {SHARE.format(slice.share)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold text-foreground">Total</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {perEvent.totalEntries}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {SHARE.format(perEvent.totalEntries === 0 ? 0 : 1)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
