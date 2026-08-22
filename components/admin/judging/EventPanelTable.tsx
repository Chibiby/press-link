import Link from "next/link";

import {
  EventJudgingBadge,
  JudgingEmptyRow,
  NotYetCell,
} from "@/components/admin/judging/EventJudgingBadge";
import { CUT_NOT_SET } from "@/components/admin/judging/JudgingPreviewNotice";
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
import { boardProgress } from "@/lib/judging/consolidate";
import type { EventIndexRow } from "@/lib/judging/event-index";
import type { ConsolidatedBoard } from "@/lib/judging/types";

const NO_PANEL = "No panel is seated, so there are no ranks to count.";
const NO_UNITS = "This event has no entries, so there is nothing to rank.";

/**
 * A round's progress as "filled of expected".
 *
 * `boardProgress` returns 0 of 0 for an event with no panel and for an event with
 * no entries, and those are different facts an admin would act on differently, so
 * neither is printed as a ratio. "0 of 0 ranks filed" invites the reading that
 * the ranks are all in.
 */
function RoundProgress({
  board,
  panelSize,
}: {
  board: ConsolidatedBoard;
  panelSize: number;
}) {
  if (panelSize === 0) return <NotYetCell reason={NO_PANEL} />;
  if (board.rows.length === 0) return <NotYetCell reason={NO_UNITS} />;

  const progress = boardProgress(board);
  return (
    <span className="tabular-nums">
      {progress.filled} / {progress.expected}
      <span className="ml-1 text-xs text-muted-foreground">
        ({progress.judgesDone}/{panelSize} judges)
      </span>
    </span>
  );
}

/**
 * The per-event panel table on `/admin/judges`.
 *
 * This is the oversight view: for each event, who is on the panel, how far each
 * round has got, what cut is in force, and the one action an admin might owe it.
 * The status column and its sentence come from the shared state machine, so this
 * table never decides for itself what "waiting" means.
 */
export function EventPanelTable({
  rows,
  emptyMessage,
}: {
  rows: EventIndexRow[];
  /** Printed when there are no events at all — a failed or empty catalog. */
  emptyMessage: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead className="whitespace-nowrap">Level · Language</TableHead>
            <TableHead className="text-right">Entries</TableHead>
            <TableHead className="text-right whitespace-nowrap">Panel</TableHead>
            <TableHead className="whitespace-nowrap">Round 1</TableHead>
            <TableHead className="whitespace-nowrap">Round 2</TableHead>
            <TableHead className="text-right whitespace-nowrap">R2 cut</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Panel sheet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <JudgingEmptyRow colSpan={9}>{emptyMessage}</JudgingEmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.eventId}>
                <TableCell>
                  <p className="font-medium">{row.typeNameEn}</p>
                  {/* Group contests and MOJO carry identical English and Filipino names in
                      the source workbook, so the second line is suppressed rather than
                      repeated — the same rule the events page follows. */}
                  {row.typeNameFil === row.typeNameEn ? null : (
                    <p className="text-xs text-muted-foreground">{row.typeNameFil}</p>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {row.slotLabel}
                  <Badge variant="outline" className="ml-2 text-[10px] capitalize">
                    {row.category}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                <TableCell className="text-right">
                  {row.panelSize === 0 ? (
                    <NotYetCell reason="No judge is assigned to this event." />
                  ) : (
                    <span className="tabular-nums">{row.panelSize}</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <RoundProgress board={row.round1} panelSize={row.panelSize} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <RoundProgress board={row.round2} panelSize={row.panelSize} />
                </TableCell>
                <TableCell className="text-right">
                  {row.round2Cut === null ? (
                    <NotYetCell reason={CUT_NOT_SET} />
                  ) : (
                    <span className="tabular-nums">{row.round2Cut}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <EventJudgingBadge status={row.state.status} />
                    {/* Printed verbatim. The state machine writes this sentence so that
                        every surface says the same thing about the same state. */}
                    {/* Capped and blockified so the sentence wraps. Left inline it is a
                        flex item that auto table-layout will widen the whole Status
                        column to fit on one line, dragging every other column off the
                        side of a phone. */}
                    <span className="block max-w-[30ch] text-xs text-muted-foreground">
                      {row.state.reason}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/admin/judges/${row.eventId}`}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
