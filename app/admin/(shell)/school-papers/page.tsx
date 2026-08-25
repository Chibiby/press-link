import { Check } from "lucide-react";
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
  eligibleSchoolPaperRows,
  filterSchoolPaperListRows,
  schoolPaperEmptyState,
  type SchoolPaperListFilters,
} from "@/lib/paper/school-paper-filters";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
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
          "id, name, district_id, is_integrated, level, paper_participation, submission_locked_at, districts(name), school_papers(language, level, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title))"
        )
        .order("name")
        .order("id")
        .range(from, to)
        .overrideTypes<RawAdminSchoolPaper[]>()
    ),
  ]);

  const allRows = toAdminSchoolPaperRows(raw);
  // A school with nothing filed has no adviser, gender, principal or grade cell to
  // show, so it drops out before either the dropdowns or the search box run — see
  // `eligibleSchoolPaperRows`. The badge's denominator follows it too, or "12 of
  // 332" would read as 320 schools hidden by a filter when they were never eligible
  // to appear here at all.
  const eligibleRows = eligibleSchoolPaperRows(allRows);
  // Both halves live in `lib/paper/school-paper-filters.ts`, tested there: the row
  // predicate — the dropdowns' own, plus the search box — and the sentence to print
  // when it keeps nothing.
  const rows = filterSchoolPaperListRows(eligibleRows, params);
  const empty = schoolPaperEmptyState(params);

  return (
    <div className="group flex flex-col gap-6">
      <PageHeading
        title="School Papers"
        subtitle="Every school's submission on record"
        badge={`${rows.length} of ${eligibleRows.length}`}
      />

      <SchoolPaperFilterBar districts={districts ?? []} schools={schools ?? []} />

      {/* Dimmed while the filter bar's navigation is still rendering on the server,
          so the table reads as catching up rather than as ignoring what was typed.
          Driven by `data-pending` on the bar above. */}
      <div className="overflow-x-auto rounded-xl border transition-opacity group-has-data-pending:opacity-50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2}>District</TableHead>
              <TableHead rowSpan={2}>School Name</TableHead>
              {/* The two grade groups each own two of the four columns below them;
                  the browser lines row 2's cells up under these on its own once
                  every other row-1 cell has claimed its rows with `rowSpan`, so
                  row 2 needs no offset math of its own. */}
              <TableHead colSpan={2} className="text-center">
                Elementary School Paper
              </TableHead>
              <TableHead colSpan={2} className="text-center">
                Secondary School Paper
              </TableHead>
              <TableHead rowSpan={2}>School Paper Adviser</TableHead>
              <TableHead rowSpan={2}>Gender</TableHead>
              <TableHead rowSpan={2}>
                School Principal / Section or Assistant Heads
              </TableHead>
              <TableHead rowSpan={2}>Status</TableHead>
              <TableHead rowSpan={2}>Action</TableHead>
            </TableRow>
            <TableRow>
              <TableHead className="text-center">English</TableHead>
              <TableHead className="text-center">Filipino</TableHead>
              <TableHead className="text-center">English</TableHead>
              <TableHead className="text-center">Filipino</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">{row.districtName}</TableCell>
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
                {/*
                  A slot the school hasn't filed is left genuinely blank rather
                  than marked "missing" — the header above it already names what
                  is on file here, and a page of dashes for the ~300 schools that
                  only owe one or two of the four would read as a page of
                  problems instead of a page of facts.
                */}
                {row.gradeSlots.map((slot) => (
                  <TableCell key={`${slot.level}:${slot.language}`} className="text-center">
                    {slot.filled && (
                      <>
                        <Check className="mx-auto size-4" aria-hidden="true" />
                        <span className="sr-only">Filed</span>
                      </>
                    )}
                  </TableCell>
                ))}
                <TableCell>{row.adviser || "—"}</TableCell>
                <TableCell>{row.gender || "—"}</TableCell>
                <TableCell>
                  {/*
                    Three distinct roles, not alternatives to one another, so each
                    name keeps its own small caption above it rather than sharing
                    one label or being told apart by position alone — the same
                    "caption over value" idiom the Integrated/Locked badges use
                    for "small fact attached to a bigger one", just spelled out as
                    text instead of a pill because three of these can appear on
                    one row at once.
                  */}
                  {row.principal || row.sectionHead || row.assistantHead ? (
                    <div className="flex flex-col gap-1.5">
                      {row.principal && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">Principal</div>
                          <div>{row.principal}</div>
                        </div>
                      )}
                      {row.sectionHead && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">Section Head</div>
                          <div>{row.sectionHead}</div>
                        </div>
                      )}
                      {row.assistantHead && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">Assistant Head</div>
                          <div>{row.assistantHead}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
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
                <TableCell colSpan={11} className="py-10 text-center whitespace-normal">
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
