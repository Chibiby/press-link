import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { ParticipantFilterBar } from "./ParticipantFilterBar";
import { ResetPaperButton } from "./ResetPaperButton";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import {
  toAdminParticipantRows,
  type RawAdminParticipant,
} from "@/lib/roster/admin-rows";
import {
  filterParticipantRows,
  participantEmptyState,
  type ParticipantFilters,
} from "@/lib/roster/participant-filters";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
import { fetchAll } from "@/lib/supabase/fetch-all";

// The `school_papers(count)` aggregate in the select below is what Supabase
// actually returns for a participant's school — not the flattened
// `paper_count` that `RawAdminParticipant` (and the pure row mapper) expect.
// This type describes the query's real shape so `overrideTypes` cannot lie
// about pre-flattening data; `rawWithCounts` below converts one into the other.
type RawAdminParticipantWithAggregate = Omit<RawAdminParticipant, "schools"> & {
  schools:
    | (Omit<NonNullable<RawAdminParticipant["schools"]>, "paper_count"> & {
        school_papers?: { count: number }[];
      })
    | null;
};
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

export default async function AdminParticipantsPage({
  searchParams,
}: {
  // `ParticipantFilters` rather than a shape declared here: the page and the
  // filter it hands these to cannot then disagree about a param's name, which is
  // a mistake with no symptom other than a control that silently does nothing.
  searchParams: Promise<ParticipantFilters>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  const [{ data: districts }, { data: schools }, raw] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
    // Paged, not one select. PostgREST caps a response at `db-max-rows`, and the
    // division has 2,273 learners: a single unbounded read of this table comes back
    // at the cap with `error: null`, so the heading below would print the cap as the
    // roster size and over a thousand learners would be missing with nothing on
    // screen saying so. `participant_number` is `not null unique` (migration 0004),
    // so the order is already total and the page windows cannot skip or repeat a row.
    fetchAll<RawAdminParticipantWithAggregate>("The participant roster", (from, to) =>
      supabase
        .from("participants")
        .select(
          "id, participant_number, first_name, middle_name, last_name, gender, schools(id, name, district_id, paper_participation, submission_locked_at, school_papers(count), districts(name)), entry_participants(entry_id)"
        )
        .order("participant_number")
        .range(from, to)
        .overrideTypes<RawAdminParticipantWithAggregate[]>()
    ),
  ]);

  // `school_papers(count)` arrives as a one-element array; the row mapper wants
  // a plain number, so it is unwrapped here rather than inside the pure module.
  const rawWithCounts: RawAdminParticipant[] = raw.map((row) => ({
    ...row,
    schools: row.schools
      ? {
          ...row.schools,
          paper_count: row.schools.school_papers?.[0]?.count ?? 0,
        }
      : null,
  }));
  // Both halves live in `lib/roster/participant-filters.ts`, tested there: the row
  // predicate, and the sentence to print when it keeps nothing. Filtering happens
  // here in memory rather than in the query because the read above already pulls
  // every row — it has to, or the count below lies — so narrowing in the database
  // would buy nothing and would introduce a second matching semantics beside
  // `matchesQuery`, where a `%` or an accent a parent typed would behave
  // differently from the same query on the school's own lists.
  const allRows = toAdminParticipantRows(rawWithCounts);
  const rows = filterParticipantRows(allRows, params);
  const empty = participantEmptyState(params);

  const multiCount = rows.filter((r) => r.isMultiEvent).length;

  return (
    <div className="group flex flex-col gap-6">
      <PageHeading
        title="Participants"
        // "12 of 2273", the way /admin/coaches and /admin/school-papers read it.
        // `allRows` is the whole roster because `fetchAll` paged it, so the total
        // is the division's real figure and not PostgREST's row cap.
        badge={`${rows.length} of ${allRows.length}`}
        subtitle={
          <>
            Every registered contestant in the division. An asterisk marks a participant competing
            in more than one event — {multiCount} shown.
          </>
        }
      />

      <ParticipantFilterBar districts={districts ?? []} schools={schools ?? []} />

      {/* Dimmed while the filter bar's navigation is still rendering on the
          server, so the table reads as catching up rather than as ignoring what
          was typed. Driven by `data-pending` on the bar above. */}
      <div className="overflow-x-auto rounded-xl border transition-opacity group-has-data-pending:opacity-50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">No.</TableHead>
              <TableHead>Participant</TableHead>
              <TableHead className="w-20">Gender</TableHead>
              <TableHead>School</TableHead>
              <TableHead>District</TableHead>
              <TableHead className="w-20">Events</TableHead>
              <TableHead className="w-44">School paper</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn(row.isMultiEvent && "bg-accent/40")}>
                <TableCell className="font-mono tabular-nums">
                  {row.displayNumber}
                </TableCell>
                <TableCell className="font-medium">{row.fullName}</TableCell>
                <TableCell>{row.gender}</TableCell>
                <TableCell>{row.schoolName}</TableCell>
                <TableCell className="text-muted-foreground">{row.districtName}</TableCell>
                <TableCell className="tabular-nums">
                  {row.eventCount}
                  {row.isMultiEvent && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      Multi
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {row.paperStatus === "incomplete" ? (
                    <span className="text-sm text-muted-foreground">
                      {PAPER_STATUS_LABEL.incomplete}
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={row.paperStatus === "submitted" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {PAPER_STATUS_LABEL[row.paperStatus]}
                      </Badge>
                      {row.submissionLocked && (
                        <Badge variant="outline" className="text-[10px]">
                          Locked
                        </Badge>
                      )}
                      <ResetPaperButton
                        schoolId={row.schoolId}
                        schoolName={row.schoolName}
                        locked={row.submissionLocked}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                {/* `whitespace-normal`, because `TableCell` sets
                    `whitespace-nowrap` in its base and this cell quotes back
                    whatever was typed — a pasted line would otherwise stretch the
                    table into a sideways scroll instead of wrapping. */}
                <TableCell colSpan={7} className="py-10 text-center whitespace-normal">
                  <p className="mx-auto max-w-[60ch] text-sm text-balance break-words text-muted-foreground">
                    {empty.message}
                  </p>
                  {empty.narrowed && (
                    // A way back, on the table itself. The Clear button in the bar
                    // above also covers this — `SEARCH_PARAM` is in its
                    // `FILTER_KEYS` — but an empty table is where the reader is
                    // looking, and a link is the honest control for it in a server
                    // component. Navigating here empties the search box too: the
                    // box follows the URL, so it clears when the param goes.
                    <Button asChild size="sm" variant="outline" className="mt-3">
                      <Link href="/admin/participants">Show all participants</Link>
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
