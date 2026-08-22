import { ArrowLeft, CircleSlash, Download, Gavel, Medal, Scissors, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventJudgingBadge } from "@/components/admin/judging/EventJudgingBadge";
import { JudgingPreviewNotice } from "@/components/admin/judging/JudgingPreviewNotice";
import { TabulationTable } from "@/components/admin/judging/TabulationTable";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { tabulationSummary } from "@/lib/judging/tabulation";
import type { TabulationRow } from "@/lib/judging/types";

import { eventFullLabel, loadJudgingEvent } from "../../judging-data";

/**
 * One event's identified results sheet.
 *
 * A **layout preview**: the sheet's rows come from `judge_ranks` joined back to
 * `participants`, `schools` and `school_papers`, and the first of those arrives with
 * migration 0018. The columns, their order and the caveat on total rank are the
 * finished sheet's, because they come from `TABULATION_COLUMNS` — the same array the
 * workbook export reads.
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
  const { row, error } = await loadJudgingEvent(eventId);

  // A failed query must not render as a missing event: `notFound()` here would tell a
  // tabulator the contest does not exist (non-negotiable 5).
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeading title="Results sheet" subtitle="This event could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load this event</AlertTitle>
          <AlertDescription>
            The contest catalog could not be loaded, so this event&rsquo;s sheet is not shown —
            this is not a report that the event has no results. Please try refreshing the
            page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!row) notFound();

  /**
   * The sheet's rows.
   *
   * Empty because `judge_ranks` and `round2_qualifiers` do not exist yet — one
   * binding, so the figures above the table and the table itself are counted off the
   * same array and cannot disagree. When migration 0018 lands, this line is where
   * the loader's rows arrive; nothing below it changes.
   */
  const rows: TabulationRow[] = [];
  const summary = tabulationSummary(rows);

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
        badge="Layout preview"
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
              title="The workbook export needs locked results, which migration 0018 records in event_rounds."
            >
              <Download />
              Export sheet
            </Button>
          </>
        }
      />

      <JudgingPreviewNotice />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Contestants"
          value={summary.contestants}
          muted
          subtitle="The unit set is drawn when round 1 opens. Individual events rank each participant, group events rank the entry."
        />
        <StatCard
          icon={Scissors}
          label="Qualifiers"
          value={summary.qualifiers}
          muted
          subtitle="Round 1's cut. Contestants tied at the line all go through, so a cut of ten can send eleven."
        />
        <StatCard
          icon={Medal}
          label="Placed"
          value={summary.placed}
          muted
          subtitle="Round 2 alone decides the winners. A contestant's total across both rounds is informational only."
        />
        <StatCard
          icon={CircleSlash}
          label="Unidentified"
          value={summary.unidentified}
          muted
          subtitle="A contestant whose identity cannot be resolved is printed as Unidentified and counted here, never dropped from the sheet."
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
          <TabulationTable
            rows={rows}
            emptyMessage="No ranks are on file for this event, so there is no sheet to show yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
