import Link from "next/link";

import {
  EventJudgingBadge,
  JudgingEmptyRow,
  NotYetCell,
} from "@/components/admin/judging/EventJudgingBadge";
import {
  CUT_NOT_ON_FILE,
  NO_ENTRIES_TO_RANK,
  NO_PANEL_SEATED,
} from "@/components/admin/judging/empty-states";
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

/**
 * A round's progress as "filled of expected", or the reason it is not a ratio.
 *
 * Both sentences live in `empty-states` rather than here: the workbook needs its
 * own copies of them (`lib/` cannot import from `components/`), and a test pins the
 * pair together, which it cannot do while one half is private to this file.
 */
function RoundProgress({
  board,
  panelSize,
}: {
  board: ConsolidatedBoard;
  panelSize: number;
}) {
  if (panelSize === 0) return <NotYetCell reason={NO_PANEL_SEATED} />;
  if (board.rows.length === 0) return <NotYetCell reason={NO_ENTRIES_TO_RANK} />;

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
                    <NotYetCell reason={CUT_NOT_ON_FILE} />
                  ) : (
                    <span className="tabular-nums">{row.round2Cut}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <EventJudgingBadge status={row.state.status} />
                    {/* Printed verbatim. The state machine writes this sentence so that
                        every surface says the same thing about the same state. */}
                    {/* `whitespace-normal` is what makes the cap work: `TableCell` sets
                        `whitespace-nowrap` in its base class and `white-space` is
                        inherited, so the cap on its own clamps the box and lets the
                        sentence run out of it and across the Panel sheet column. With
                        both, it wraps — and the Status column stops widening to fit one
                        line, which would drag every other column off the side of a
                        phone. */}
                    <span className="block max-w-[30ch] whitespace-normal text-xs text-muted-foreground">
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
