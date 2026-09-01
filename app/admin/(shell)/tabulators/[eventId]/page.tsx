import {
  ArrowLeft,
  CircleSlash,
  Download,
  Gavel,
  ListOrdered,
  Medal,
  Scissors,
  Users,
} from "lucide-react";
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
   * `events.round2_cut` is `not null default 30`, so this needs a failed read to happen
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
            {/* A plain link, not a client-side fetch: the browser saves what a
                navigation returns, and the handler answers a caller it refuses with
                a status rather than with a redirect to a login page — which is what
                would otherwise be saved under an .xlsx name. */}
            <Button asChild size="sm" variant="outline">
              {/* The title says what the file holds, because it is not what this page
                  holds: the table below is the event's whole working and the workbook
                  is the sheet a division circulates. */}
              <a
                href={`/admin/tabulators/${row.eventId}/export`}
                title="Every contestant the round 1 judge ranked, with their placements — the qualifiers and anyone ranked past the cut. A contestant the judge left blank is on this page but not in the file."
              >
                <Download />
                Export sheet
              </a>
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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={Users}
          label="Contestants"
          {...tile(
            summary.contestants,
            "The unit set drawn when round 1 opened. Individual events rank each participant, group events rank the entry."
          )}
        />
        {/* Its own tile, beside the qualifiers rather than instead of them. A judge
            ranks as far down the field as they mean to and the cut decides who
            advances, so the two numbers are free to disagree — and where they do, the
            difference is a contestant the judge placed and the round eliminated.
            Printing only the cut's number reports an administrative setting as though
            it were the judging, and leaves an officer counting the exported sheet to
            find out why it holds more rows. */}
        <StatCard
          icon={ListOrdered}
          label="Ranked"
          {...tile(
            summary.ranked,
            "Contestants the round 1 judge placed. Everyone here is on the exported sheet; a blank on the judge's sheet is an elimination and is not."
          )}
        />
        <StatCard
          icon={Scissors}
          label="Qualifiers"
          {...tile(
            summary.qualifiers,
            summary.ranked > summary.qualifiers
              ? `Through to round 2. The other ${summary.ranked - summary.qualifiers} the judge ranked fell outside the cut this round was closed under.`
              : "Round 1's cut. Contestants tied at the line all go through, so a cut of ten can send eleven."
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
