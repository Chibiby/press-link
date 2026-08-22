import { ArrowLeft, CircleSlash, Download, Gavel, Medal, Scissors, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventJudgingBadge } from "@/components/admin/judging/EventJudgingBadge";
import { CUT_NOT_ON_FILE } from "@/components/admin/judging/empty-states";
import { TabulationTable } from "@/components/admin/judging/TabulationTable";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { tabulationSummary } from "@/lib/judging/tabulation";

import { eventFullLabel, loadEventSheet } from "../../judging-data";

/**
 * One event's identified results sheet.
 *
 * Every row and every figure is read: the standings come from `judge_ranks` and
 * `round2_qualifiers` through `finalStandings`, and the names, coaches, schools and
 * papers beside them come from the entries. `loadEventSheet` does both halves and
 * `attachIdentities` joins them. The columns, their order and the caveat on total
 * rank come from `TABULATION_COLUMNS` — the same array the workbook export reads, so
 * the page and the spreadsheet cannot disagree.
 *
 * This is the identified side of the wall. A judge never reaches it: the anonymous
 * boards live on `/admin/judges/[eventId]` and in the judge portal, and the join
 * between the two happens only in `lib/judging/tabulation` (non-negotiable 1).
 */
export default async function EventSheetPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { row, rows, unidentified, error } = await loadEventSheet(eventId);

  // A failed query must not render as a missing event: `notFound()` here would tell a
  // tabulator the contest does not exist (non-negotiable 5).
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeading title="Results sheet" subtitle="This event could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load this event</AlertTitle>
          <AlertDescription>
            {error} No figure below is shown, because a blank sheet here would read as an
            event nobody has ranked. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!row) notFound();

  const summary = tabulationSummary(rows);

  /**
   * With no cut on file there is no field to divide, so no standings were computed and
   * every figure on this page is unavailable rather than nought (non-negotiable 5).
   * `events.round2_cut` is `not null default 10`, so this needs a failed read to happen
   * at all — but it is the one absence left on this page, and an unmeasured zero here
   * would be read as a contest nobody entered.
   */
  const noCut = row.standings === null;

  /**
   * One tile's figure and the line under it. Shared by all four so a blank tile can
   * never end up carrying a subtitle that explains a number it is not showing.
   */
  const tile = (value: number, subtitle: string) =>
    noCut
      ? { value: "—", subtitle: `${CUT_NOT_ON_FILE} ${subtitle}`, muted: true }
      : { value, subtitle, muted: false };

  return (
    <div className="space-y-6">
      <Button asChild size="sm" variant="ghost" className="-ml-2">
        <Link href="/admin/tabulators">
          <ArrowLeft />
          All sheets
        </Link>
      </Button>

      <PageHeading
        title={row.typeNameEn}
        subtitle={`${eventFullLabel(row.level, row.language)} · ${row.entries} ${
          row.entries === 1 ? "entry" : "entries"
        } on file`}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/judges/${row.eventId}`}>
                <Gavel />
                Panel boards
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled
              title="No per-event workbook has been written yet. The export on the sheets index covers every event, this one among them."
            >
              <Download />
              Export sheet
            </Button>
          </>
        }
      />

      {/* A failed join is a fault, not a quiet grey number: the ranks below are correct
          and the contestant they belong to could not be named, and a tabulator has to
          know which rows those are before reading a placement off them. */}
      {unidentified.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>
            {unidentified.length === 1
              ? "One contestant could not be identified"
              : `${unidentified.length} contestants could not be identified`}
          </AlertTitle>
          <AlertDescription>
            {unidentified.length === 1 ? "Code" : "Codes"} {unidentified.join(", ")}{" "}
            {unidentified.length === 1 ? "is" : "are"} ranked on this sheet but could not be
            joined back to a school. The ranks are right; the rows are kept and marked
            rather than dropped, because a dropped row would look like a contestant who
            never entered.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Contestants"
          {...tile(
            summary.contestants,
            "The unit set drawn when round 1 opened. Individual events rank each participant, group events rank the entry."
          )}
        />
        <StatCard
          icon={Scissors}
          label="Qualifiers"
          {...tile(
            summary.qualifiers,
            "Round 1's cut. Contestants tied at the line all go through, so a cut of ten can send eleven."
          )}
        />
        <StatCard
          icon={Medal}
          label="Placed"
          {...tile(
            summary.placed,
            "Round 2 alone decides the winners. A contestant's total across both rounds is informational only."
          )}
        />
        <StatCard
          icon={CircleSlash}
          label="Unidentified"
          {...tile(
            summary.unidentified,
            "A contestant whose identity cannot be resolved is printed as Unidentified and counted here, never dropped from the sheet."
          )}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Results sheet
            <EventJudgingBadge status={row.state.status} />
          </CardTitle>
          <CardDescription>{row.state.reason}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Both messages are about contestants, not ranks. A seated panel with entries
              fills this table the moment round 1 opens — the rank cells stay empty until
              a judge files, but the rows are there, so "no ranks on file" would be the
              wrong explanation for an empty one. */}
          <TabulationTable
            rows={rows}
            emptyMessage={
              noCut
                ? `${CUT_NOT_ON_FILE} Without one there is no field to divide, so no standings were drawn.`
                : "This event has no contestants on file, so there is no sheet to draw."
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
