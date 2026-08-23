import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { CoachFilterBar } from "./CoachFilterBar";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { toAdminCoachRows, type RawAdminCoach } from "@/lib/roster/admin-coach-rows";
import {
  coachEmptyState,
  filterCoachListRows,
  type CoachListFilters,
} from "@/lib/roster/coach-filters";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default async function AdminCoachesPage({
  searchParams,
}: {
  // `CoachListFilters` rather than a shape declared here: the page and the filter it
  // hands these to cannot then disagree about a param's name, which is a mistake
  // with no symptom other than a control that silently does nothing.
  searchParams: Promise<CoachListFilters>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  const [{ data: districts }, { data: schools }, { data: events }, raw] =
    await Promise.all([
      supabase.from("districts").select("id, name").order("name"),
      supabase.from("schools").select("id, name, district_id").order("name"),
      supabase.from("events").select("id, name").order("sort_order"),
      // Paged, not one select: PostgREST caps a response at `db-max-rows`, so once
      // this table passes the cap an unbounded read returns the cap with no error and
      // the roster below is short with nothing saying so. 487 coaches today, so this
      // is prophylactic — but `coaches.last_name` is not unique, so the `.order("id")`
      // is not: without it two coaches sharing a surname can land on either side of a
      // page boundary between requests, and paging would drop one and repeat the other.
      fetchAll<RawAdminCoach>("The coach roster", (from, to) =>
        supabase
          .from("coaches")
          .select(
            "id, first_name, middle_name, last_name, gender, schools(id, name, district_id, districts(name)), entry_coaches(entries(id, event_id, events(category, level, language)))"
          )
          .order("last_name")
          .order("id")
          .range(from, to)
          .overrideTypes<RawAdminCoach[]>()
      ),
    ]);

  const allRows = toAdminCoachRows(raw);
  // Both halves live in `lib/roster/coach-filters.ts`, tested there: the row
  // predicate — the dropdowns' own, plus the search box — and the sentence to print
  // when it keeps nothing.
  const rows = filterCoachListRows(allRows, params);
  const empty = coachEmptyState(params);

  const multiCount = rows.filter((r) => r.isMultiEntry).length;

  return (
    <div className="group flex flex-col gap-6">
      <PageHeading
        title="Coaches"
        badge={`${rows.length} of ${allRows.length}`}
        subtitle={
          <>
            Every registered coach in the division. An asterisk marks a coach on more than one
            entry — {multiCount} shown.
          </>
        }
      />

      <CoachFilterBar
        districts={districts ?? []}
        schools={schools ?? []}
        events={events ?? []}
      />

      {/* Dimmed while the filter bar's navigation is still rendering on the server,
          so the table reads as catching up rather than as ignoring what was typed.
          Driven by `data-pending` on the bar above. */}
      <div className="overflow-x-auto rounded-xl border transition-opacity group-has-data-pending:opacity-50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Coach</TableHead>
              <TableHead className="w-20">Gender</TableHead>
              <TableHead>School</TableHead>
              <TableHead>District</TableHead>
              <TableHead className="w-24">Entries</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn(row.isMultiEntry && "bg-accent/40")}>
                <TableCell className="font-medium">{row.displayName}</TableCell>
                <TableCell>{row.gender}</TableCell>
                <TableCell>{row.schoolName}</TableCell>
                <TableCell className="text-muted-foreground">{row.districtName}</TableCell>
                <TableCell className="tabular-nums">
                  {row.entryCount}
                  {row.isMultiEntry && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      Multi
                    </Badge>
                  )}
                  {row.entryCount === 0 && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Unassigned
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                {/* `whitespace-normal`, because `TableCell` sets `whitespace-nowrap`
                    in its base and this cell quotes back whatever was typed — a
                    pasted line would otherwise stretch the table into a sideways
                    scroll instead of wrapping. */}
                <TableCell colSpan={5} className="py-10 text-center whitespace-normal">
                  <p className="mx-auto max-w-[60ch] text-sm text-balance break-words text-muted-foreground">
                    {empty.message}
                  </p>
                  {empty.narrowed && (
                    // A way back, on the table itself. The Clear button in the bar
                    // above also covers this — `SEARCH_PARAM` is in its
                    // `FILTER_KEYS` — but an empty table is where the reader is
                    // looking, and a link is the honest control for it in a server
                    // component. Navigating here empties the search box too: the box
                    // follows the URL, so it clears when the param goes.
                    <Button asChild size="sm" variant="outline" className="mt-3">
                      <Link href="/admin/coaches">Show all coaches</Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
