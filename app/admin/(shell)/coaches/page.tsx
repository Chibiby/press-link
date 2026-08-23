import { requireAdmin } from "@/app/admin/guard";
import { CoachFilterBar } from "./CoachFilterBar";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import {
  toAdminCoachRows,
  filterCoachRows,
  type RawAdminCoach,
} from "@/lib/roster/admin-coach-rows";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface SearchParams {
  district?: string;
  school?: string;
  gender?: string;
  multi?: string;
  unassigned?: string;
  event?: string;
  category?: string;
  level?: string;
  language?: string;
}

export default async function AdminCoachesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
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
  const rows = filterCoachRows(allRows, params);

  const multiCount = rows.filter((r) => r.isMultiEntry).length;

  return (
    <div className="flex flex-col gap-6">
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

      <div className="overflow-x-auto rounded-xl border">
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
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No coaches match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
