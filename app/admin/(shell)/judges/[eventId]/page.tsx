import { ArrowLeft, FileSpreadsheet, Lock, Scissors, Trophy, Undo2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BoardTable } from "@/components/admin/judging/BoardTable";
import { EventJudgingBadge, NotYetCell } from "@/components/admin/judging/EventJudgingBadge";
import { JudgeRosterTable } from "@/components/admin/judging/JudgeRosterTable";
import {
  CUT_NOT_SET,
  JudgingPreviewNotice,
  JUDGING_NOT_INSTALLED,
} from "@/components/admin/judging/JudgingPreviewNotice";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_ROUND2_CUT } from "@/lib/judging/qualifiers";

import { eventFullLabel, loadJudgingEvent } from "../../judging-data";

/**
 * One event's panel and its two boards.
 *
 * A **layout preview**, like the index that links here. The boards are consolidated
 * by the real `consolidateRound` over an empty panel, so each one reports itself as
 * not ranked and explains why — which is exactly what the finished page shows on
 * the morning before judging starts.
 *
 * ## Why the controls are here but disabled
 *
 * Every state change in this feature is a `security definer` RPC (non-negotiable
 * 2), and those RPCs arrive with the migration. Rendering the controls now settles
 * where they live and what they are called; leaving them out would settle nothing
 * and would make this page a list rather than a layout. `JudgingPreviewNotice`
 * states on screen that nothing here writes.
 */
export default async function EventPanelPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { row, error } = await loadJudgingEvent(eventId);

  // A failed query must not render as a missing event: `notFound()` here would tell
  // an admin the contest does not exist (non-negotiable 5).
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeading title="Event panel" subtitle="This event could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load this event</AlertTitle>
          <AlertDescription>
            The contest catalog could not be loaded, so this event&rsquo;s panel is not shown —
            this is not a report that the event has no panel. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!row) notFound();

  return (
    <div className="space-y-6">
      <Button asChild size="sm" variant="ghost" className="-ml-2">
        <Link href="/admin/judges">
          <ArrowLeft />
          All panels
        </Link>
      </Button>

      <PageHeading
        title={row.typeNameEn}
        badge="Layout preview"
        subtitle={`${eventFullLabel(row.level, row.language)} · ${row.entries} ${
          row.entries === 1 ? "entry" : "entries"
        } on file`}
        actions={
          <Button
            asChild
            size="sm"
            variant="outline"
            title="The identified sheet for this event, on the tabulators' side."
          >
            <Link href={`/admin/tabulators/${row.eventId}`}>
              <FileSpreadsheet />
              Results sheet
            </Link>
          </Button>
        }
      />

      <JudgingPreviewNotice />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Judging status</CardTitle>
          <CardDescription>{row.state.reason}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Status
              </dt>
              <dd>
                <EventJudgingBadge status={row.state.status} />
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Panel seats
              </dt>
              <dd className="text-sm tabular-nums">
                {row.panelSize === 0 ? (
                  <NotYetCell reason={JUDGING_NOT_INSTALLED} />
                ) : (
                  row.panelSize
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Round 2 cut
              </dt>
              {/* Blank, not {DEFAULT_ROUND2_CUT}: the default is what the RPC will
                  apply if the division does not choose otherwise, and printing it
                  here would show a decision nobody has made. */}
              <dd className="text-sm tabular-nums">
                {row.round2Cut ?? <NotYetCell reason={CUT_NOT_SET} />}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              size="sm"
              variant="outline"
              disabled
              title={`Setting the cut writes events.round2_cut, which migration 0018 adds. It will default to ${DEFAULT_ROUND2_CUT}.`}
            >
              <Scissors />
              Set round 2 cut
            </Button>
            <Button
              size="sm"
              disabled
              title="Closing round 1 draws the qualifiers. It needs the close_round_1 RPC, which migration 0018 adds."
            >
              <Lock />
              Close round 1
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Reopening round 1 discards the qualifiers it drew. It needs the reopen_round_1 RPC, which migration 0018 adds."
            >
              <Undo2 />
              Reopen round 1
            </Button>
            <Button
              size="sm"
              disabled
              title="Locking the results publishes the sheet. It needs the lock_results RPC, which migration 0018 adds."
            >
              <Trophy />
              Lock results
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            These are this event&rsquo;s controls. Each one is a single database function that
            checks the round is ready before it acts, so closing a round with a judge still
            outstanding is refused by the database rather than by this page. None of them
            exists yet, so every control is disabled and nothing here writes.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Panel</CardTitle>
          <CardDescription>
            The judges seated on this event, in seat order. Each ranks independently; the
            ranks are then added, so a low total is a good total.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JudgeRosterTable rows={[]} emptyMessage={JUDGING_NOT_INSTALLED} />
        </CardContent>
      </Card>

      <BoardTable
        board={row.round1}
        judgeNames={{}}
        emptyMessage="No contestants are drawn for round 1 yet — the unit set is built when the round opens."
      />

      <BoardTable
        board={row.round2}
        judgeNames={{}}
        emptyMessage="Round 2's contestants are the qualifiers drawn when round 1 closes, so this board is empty until then."
      />
    </div>
  );
}
