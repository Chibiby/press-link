import { Download } from "lucide-react";
import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { SchoolPaperFilterBar } from "./SchoolPaperFilterBar";
import { UnlockSubmissionButton } from "./UnlockSubmissionButton";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { fetchAdminSchoolPaperRows } from "@/lib/paper/fetch-admin-school-papers";
import {
  eligibleSchoolPaperRows,
  filterSchoolPaperListRows,
  schoolPaperEmptyState,
  schoolPaperSearchQuery,
  type SchoolPaperListFilters,
} from "@/lib/paper/school-paper-filters";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
import { filterHref } from "@/lib/search/filter-params";
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

  const [{ data: districts }, { data: schools }, allRows] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name").order("name"),
    // Same query, and the same paging, as its own export route reads — see
    // `fetchAdminSchoolPaperRows`'s doc for why this cannot be the inline select it
    // used to be: a downloaded workbook must never disagree with the screen it was
    // downloaded from.
    fetchAdminSchoolPaperRows(supabase),
  ]);

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

  // Built from the same `params` the dropdowns and search box already narrowed
  // `rows` with, so a reader who filters the table down and then clicks Export
  // downloads exactly what's on screen, not the whole roster. `schoolPaperSearchQuery`
  // rather than reading `params.q` raw, so the href's `q` goes through the same
  // trim/empty-string rule the table itself already applies.
  const exportHref = (() => {
    const qp = new URLSearchParams();
    if (params.district) qp.set("district", params.district);
    if (params.school) qp.set("school", params.school);
    if (params.status) qp.set("status", params.status);
    if (params.lock) qp.set("lock", params.lock);
    if (params.language) qp.set("language", params.language);
    const q = schoolPaperSearchQuery(params);
    if (q) qp.set("q", q);
    return filterHref("/admin/school-papers/export", qp.toString());
  })();

  return (
    <div className="group flex flex-col gap-6">
      <PageHeading
        title="School Papers"
        subtitle="Every school's submission on record"
        badge={`${rows.length} of ${eligibleRows.length}`}
        actions={
          <Button asChild variant="outline" size="sm">
            {/* A route handler, and a plain anchor rather than next/link — see
                the events page's Export button for why: next/link would build a
                workbook on hover. */}
            <a href={exportHref}>
              <Download className="size-4" />
              Export to Excel
            </a>
          </Button>
        }
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
              <TableHead rowSpan={2}>School Principal</TableHead>
              <TableHead rowSpan={2}>Section Head</TableHead>
              <TableHead rowSpan={2}>Assistant Head</TableHead>
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
                  <TableCell key={`${slot.level}:${slot.language}`}>{slot.title}</TableCell>
                ))}
                <TableCell>{row.adviser || "—"}</TableCell>
                <TableCell>{row.gender || "—"}</TableCell>
                <TableCell>{row.principal || "—"}</TableCell>
                <TableCell>{row.sectionHead || "—"}</TableCell>
                <TableCell>{row.assistantHead || "—"}</TableCell>
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
                <TableCell colSpan={13} className="py-10 text-center whitespace-normal">
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
