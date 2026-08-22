import Link from "next/link";

import {
  EventJudgingBadge,
  JudgingEmptyRow,
  NotYetCell,
} from "@/components/admin/judging/EventJudgingBadge";
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
import type { EventIndexRow } from "@/lib/judging/event-index";

const NO_QUALIFIERS = "round2_qualifiers arrives with migration 0018.";
const NO_RESULTS = "event_rounds, which records the results lock, arrives with migration 0018.";

/**
 * The per-event index on `/admin/tabulators`.
 *
 * Built from the same {@link EventIndexRow} the judges page uses, so the status an
 * event shows here can never disagree with the status it shows there — that is the
 * whole reason the row is assembled in `lib/judging/event-index` rather than in
 * either page.
 *
 * The columns differ from the judges page because the question differs: a
 * tabulator is not chasing a panel, they are looking for the sheet that is ready
 * to publish. Panel progress is therefore compressed into the status column, and
 * the space goes to what the sheet will say.
 */
export function TabulationIndexTable({
  rows,
  emptyMessage,
}: {
  rows: EventIndexRow[];
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
            <TableHead className="text-right whitespace-nowrap">Qualifiers</TableHead>
            <TableHead className="text-right whitespace-nowrap">Placed</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Sheet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <JudgingEmptyRow colSpan={7}>{emptyMessage}</JudgingEmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.eventId}>
                <TableCell>
                  <p className="font-medium">{row.typeNameEn}</p>
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
                {/* Real, and labelled "Entries" rather than "Contestants": an individual
                    event ranks each participant on an entry separately, so its contestant
                    count is higher than its entry count and only `contestUnits` can say by
                    how much. */}
                <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                <TableCell className="text-right">
                  <NotYetCell reason={NO_QUALIFIERS} />
                </TableCell>
                <TableCell className="text-right">
                  <NotYetCell reason={NO_RESULTS} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <EventJudgingBadge status={row.state.status} />
                    {/* Capped and wrapped for the same reason as the judges table.
                        `TableCell`'s base `whitespace-nowrap` is inherited, so the cap
                        alone would clamp the box and spill the sentence across the
                        Sheet link; and with no cap at all this column widens until
                        that link is off the side of the screen. */}
                    <span className="block max-w-[30ch] whitespace-normal text-xs text-muted-foreground">
                      {row.state.reason}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/admin/tabulators/${row.eventId}`}>Open</Link>
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
