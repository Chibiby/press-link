import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { PerSchoolTable } from "@/components/dashboard/PerSchoolTable";
import { Button } from "@/components/ui/button";
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
import {
  filterOverallDataRows,
  overallDataEmptyState,
  overallDataListDescription,
  overallDataResetHref,
  overallDataSearchQuery,
  type OverallDataFilters,
} from "@/lib/admin/overall-data-filters";
import { countByEventType, summarisePerEvent } from "@/lib/dashboard/per-event";
import { summarisePerSchool } from "@/lib/dashboard/per-school";
import { fetchSchoolFacts } from "@/lib/dashboard/school-facts";
import { fetchAll } from "@/lib/supabase/fetch-all";

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
  //
  // `OverallDataFilters` rather than a shape declared here, so this page and the
  // filter it hands these to cannot disagree about a param's name — a mistake with
  // no symptom other than a control that silently does nothing.
  searchParams: Promise<OverallDataFilters>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const { district } = params;
  const query = overallDataSearchQuery(params);

  const [facts, districtResult, entryRows, typeCount] = await Promise.all([
    fetchSchoolFacts(supabase),
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
    // Paged, not one select. This page's heading promises nothing on it is truncated,
    // and at 977 entries against a silent `db-max-rows` cap that promise was about
    // twenty entries from becoming false: the table below counts the rows it received,
    // so a clipped read would under-report every event type's share and the total.
    // `.order("id")` is new — the select had no ordering at all, and LIMIT/OFFSET with
    // no ORDER BY lets Postgres return the windows in any order it likes, which skips
    // and repeats rows. Ordering by the primary key is the cheapest total order; this
    // page groups and counts, so no visible order changes.
    fetchAll<EntryTypeRow>("Entries by event type", (from, to) =>
      supabase
        .from("entries")
        .select("id, schools(district_id), events(event_type_id, event_types(name_en))")
        .order("id")
        .range(from, to)
        .overrideTypes<EntryTypeRow[]>()
    ),
    supabase.from("event_types").select("*", { count: "exact", head: true }),
  ]);

  const districts = districtResult.data ?? [];
  const districtName = district
    ? (districts.find((row) => row.id === district)?.name ?? "Unknown district")
    : null;

  const activeSchools = district
    ? facts.active.filter((school) => school.districtId === district)
    : facts.active;

  // Summarised from the *unsearched* set, on purpose. `summarisePerSchool` derives
  // `totals`, `activeSchools` and `registeredSchools` from what it is handed, so
  // passing it a searched array would turn the row labelled "Division total" into
  // the total of whatever someone typed — a wrong number presented as an official
  // one, on the page these figures get read out of. The district filter above is
  // upstream of it because a district selection is *meant* to move the totals and
  // the denominator; the search is not, so it is applied to the rows below instead.
  const perSchool = summarisePerSchool(activeSchools, {
    limit: activeSchools.length,
    registeredSchools: district
      ? (facts.registeredByDistrict[district] ?? 0)
      : facts.registeredSchools,
  });

  // The rows the panel lists. `perSchool.rows` is already ranked and uncut, so this
  // only removes; the order the reader sees is still biggest-first.
  const shownRows = filterOverallDataRows(perSchool.rows, params);
  // Rows swapped, every figure kept. `hiddenSchools` stays as `summarisePerSchool`
  // left it — 0, because `limit` is the whole set — so the shared table's "showing
  // the top N by entries" note stays off: nothing here was cut by rank, and that
  // sentence would be the wrong explanation for a search.
  const shownPerSchool = { ...perSchool, rows: shownRows };
  const empty = overallDataEmptyState(params);

  // District only. The search box deliberately does not reach this: these are
  // population figures for the whole selection, and "entries by event type" filtered
  // to one school's name would be a different question wearing this table's heading.
  const typeRows = entryRows
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
    // `group`, so the filter bar's `data-pending` can dim the school list below it
    // while the filtered render is still on the server. Nothing in this subtree
    // uses an unnamed `group-*` variant — every group in `components/ui` is named
    // (`/card`, `/input-group`) — so there is nothing here to cross-talk with.
    <div className="group space-y-6">
      <PageHeading
        title="Overall Data"
        badge={districtName ?? undefined}
        subtitle={
          <>
            {districtName
              ? `Every school in ${districtName} that has registered a learner, a coach or an entry, and the events they entered.`
              : "Every school that has registered a learner, a coach or an entry, and the events they entered."}
            {query
              ? // The unfiltered page promises nothing on it is truncated, so a search
                // has to say what it narrowed and what it left alone. The school list
                // is the only thing it touches: every total here, and the whole
                // event-type table, still covers the selection.
                ` The school list is narrowed to “${query}”; the totals and the event-type table below are not.`
              : " Nothing on this page is truncated."}
          </>
        }
      />

      <OverallDataFilter districts={districts} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schools with data</CardTitle>
          <CardDescription>
            {overallDataListDescription(params, {
              shown: shownRows.length,
              activeSchools: perSchool.activeSchools,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Dimmed while the bar's navigation is still rendering, so the list reads
              as catching up rather than as ignoring what was typed. Only this panel:
              the event-type table below is not searched, and dimming it would imply
              it was about to change. */}
          <div className="transition-opacity group-has-data-pending:opacity-50">
            {shownRows.length === 0 ? (
              // Not `PerSchoolTable`'s own empty state. That one says "No school has
              // an entry yet", which is a claim this page must never make on behalf
              // of a search that matched nothing while two dozen schools are on file.
              // The shared component is left exactly as the dashboard uses it.
              <div className="py-8 text-center">
                <p className="mx-auto max-w-[60ch] text-sm text-balance break-words text-muted-foreground">
                  {empty.message}
                </p>
                {empty.narrowed ? (
                  // A way back, where the reader is looking. The Clear button in the
                  // bar covers this too, but this one keeps the district when the
                  // search is what went wrong — clearing the district would re-scope
                  // every total on the page, which is more than was asked for.
                  <Button asChild size="sm" variant="outline" className="mt-3">
                    <Link href={overallDataResetHref(params)}>{empty.resetLabel}</Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              // Rows filtered before they get here, never inside the component: the
              // dashboard renders this same table with no search box, and a filter
              // inside it would either change that page or need a flag to stop it.
              <PerSchoolTable summary={shownPerSchool} />
            )}
          </div>
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
          {/* No colour swatches in this table, on purpose: summarisePerEvent assigns
              eight chart tokens by rank and wraps past the eighth, so beyond the donut's
              top eight a swatch would repeat a hue and imply two types are the same
              series. The donut's legend is where colour carries meaning; here the
              numbers do. */}
          {perEvent.slices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No entries in this selection yet.
            </p>
          ) : (
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
                      {slice.entries.toLocaleString("en-PH")}
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
                    {perEvent.totalEntries.toLocaleString("en-PH")}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {SHARE.format(perEvent.totalEntries === 0 ? 0 : 1)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
