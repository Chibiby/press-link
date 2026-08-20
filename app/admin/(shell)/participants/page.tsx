import { requireAdmin } from "@/app/admin/guard";
import { ParticipantFilterBar } from "./ParticipantFilterBar";
import { ResetPaperButton } from "./ResetPaperButton";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import {
  toAdminParticipantRows,
  type RawAdminParticipant,
} from "@/lib/roster/admin-rows";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";

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
  multi?: string;
}

export default async function AdminParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  const [{ data: districts }, { data: schools }, { data: raw }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
    supabase
      .from("participants")
      .select(
        "id, participant_number, first_name, middle_name, last_name, gender, schools(id, name, district_id, paper_participation, submission_locked_at, school_papers(count), districts(name)), entry_participants(entry_id)"
      )
      .order("participant_number")
      .overrideTypes<RawAdminParticipantWithAggregate[]>(),
  ]);

  // `school_papers(count)` arrives as a one-element array; the row mapper wants
  // a plain number, so it is unwrapped here rather than inside the pure module.
  const rawWithCounts: RawAdminParticipant[] = (raw ?? []).map((row) => ({
    ...row,
    schools: row.schools
      ? {
          ...row.schools,
          paper_count: row.schools.school_papers?.[0]?.count ?? 0,
        }
      : null,
  }));
  let rows = toAdminParticipantRows(rawWithCounts);
  if (params.district) rows = rows.filter((r) => r.districtId === params.district);
  if (params.school) rows = rows.filter((r) => r.schoolId === params.school);
  if (params.multi === "1") rows = rows.filter((r) => r.isMultiEvent);

  const multiCount = rows.filter((r) => r.isMultiEvent).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Participants"
        badge={`${rows.length} listed`}
        subtitle={
          <>
            Every registered contestant in the division. An asterisk marks a participant competing
            in more than one event — {multiCount} shown.
          </>
        }
      />

      <ParticipantFilterBar districts={districts ?? []} schools={schools ?? []} />

      <div className="overflow-x-auto rounded-xl border">
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
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No participants match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
