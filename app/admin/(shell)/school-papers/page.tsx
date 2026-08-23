import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { SchoolPaperFilterBar } from "./SchoolPaperFilterBar";
import { UnlockSubmissionButton } from "./UnlockSubmissionButton";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import {
  toAdminSchoolPaperRows,
  type RawAdminSchoolPaper,
} from "@/lib/paper/admin-papers";
import {
  filterSchoolPaperListRows,
  schoolPaperEmptyState,
  type SchoolPaperListFilters,
} from "@/lib/paper/school-paper-filters";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
import { PAPER_LEVEL_LABEL, type PaperSlot } from "@/lib/paper/level";
import { LANGUAGE_LABEL } from "@/lib/events-catalog";
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

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * A `whole` paper is named by its language alone, the way it always has been —
 * a non-integrated row must read exactly as it did before levels existed. Only
 * an integrated school's papers carry the level, because only there does the
 * language on its own fail to identify which paper is meant.
 */
function slotLabel(slot: PaperSlot): string {
  return slot.level === "whole"
    ? LANGUAGE_LABEL[slot.language]
    : `${LANGUAGE_LABEL[slot.language]} · ${PAPER_LEVEL_LABEL[slot.level]}`;
}

export default async function AdminSchoolPapersPage({
  searchParams,
}: {
  // `SchoolPaperListFilters` rather than a shape declared here: the page and the
  // filter it hands these to cannot then disagree about a param's name, which is a
  // mistake with no symptom other than a control that silently does nothing.
  searchParams: Promise<SchoolPaperListFilters>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  const [{ data: districts }, { data: schools }, raw] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name").order("name"),
    // Paged, not one select: PostgREST caps a response at `db-max-rows` with no error,
    // so an unbounded read of a table that grows past it drops schools off the bottom
    // of this list silently. 332 schools today, so this is prophylactic — the
    // `.order("id")` is not: `schools.name` has no unique constraint (migration 0001),
    // and two schools sharing a name would shuffle between page requests.
    fetchAll<RawAdminSchoolPaper>("The school paper registry", (from, to) =>
      supabase
        .from("schools")
        .select(
          "id, name, district_id, is_integrated, paper_participation, paper_answered_at, submission_locked_at, districts(name), school_papers(language, level)"
        )
        .order("name")
        .order("id")
        .range(from, to)
        .overrideTypes<RawAdminSchoolPaper[]>()
    ),
  ]);

  const allRows = toAdminSchoolPaperRows(raw);
  // Both halves live in `lib/paper/school-paper-filters.ts`, tested there: the row
  // predicate — the dropdowns' own, plus the search box — and the sentence to print
  // when it keeps nothing.
  const rows = filterSchoolPaperListRows(allRows, params);
  const empty = schoolPaperEmptyState(params);

  return (
    <div className="group flex flex-col gap-6">
      <PageHeading
        title="School Papers"
        subtitle="Every school's submission on record"
        badge={`${rows.length} of ${allRows.length}`}
      />

      <SchoolPaperFilterBar districts={districts ?? []} schools={schools ?? []} />

      {/* Dimmed while the filter bar's navigation is still rendering on the server,
          so the table reads as catching up rather than as ignoring what was typed.
          Driven by `data-pending` on the bar above. */}
      <div className="overflow-x-auto rounded-xl border transition-opacity group-has-data-pending:opacity-50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead>District</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Papers on file</TableHead>
              <TableHead>Answered</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{row.schoolName}</span>
                    {row.isIntegrated && (
                      <Badge variant="secondary" className="text-[10px]">
                        Integrated
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.districtName}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={row.status === "submitted" ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {PAPER_STATUS_LABEL[row.status]}
                    </Badge>
                    {row.locked && (
                      <Badge variant="outline" className="text-[10px]">
                        Locked
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {/*
                    An integrated school owes four papers and the useful question
                    about it is which of the four are missing, so all four slots
                    are drawn and the empty ones are outlined. Every other school
                    keeps the old cell exactly: the languages on file, or a dash.
                  */}
                  {row.isIntegrated ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.slots.map((slot) => (
                        <Badge
                          key={`${slot.language}:${slot.level}`}
                          variant="outline"
                          className={
                            slot.filled
                              ? "text-[10px]"
                              : "border-dashed text-[10px] text-muted-foreground/60"
                          }
                        >
                          {slotLabel(slot)}
                        </Badge>
                      ))}
                    </div>
                  ) : row.languages.length === 0 ? (
                    "—"
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {row.languages.map((lang) => (
                        <Badge key={lang} variant="outline" className="text-[10px]">
                          {LANGUAGE_LABEL[lang]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {row.answeredAt ? DATE_FORMAT.format(new Date(row.answeredAt)) : "—"}
                </TableCell>
                <TableCell>
                  {row.locked && (
                    <UnlockSubmissionButton schoolId={row.id} schoolName={row.schoolName} />
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
                <TableCell colSpan={6} className="py-10 text-center whitespace-normal">
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
                      <Link href="/admin/school-papers">Show all schools</Link>
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
