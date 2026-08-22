import { JudgingEmptyRow } from "@/components/admin/judging/EventJudgingBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { boardProgress } from "@/lib/judging/consolidate";
import { ROUND_LABEL, ROUND_SCOPE } from "@/lib/judging/round";
import type { ConsolidatedBoard } from "@/lib/judging/types";

/**
 * One round's consolidated board: a column per judge, then the sum and its place.
 *
 * The panel's columns are drawn from `board.judgeIds`, which is in seat order, so
 * seat 1 is always the leftmost judge and a tabulator comparing two events reads
 * the same panel in the same order.
 *
 * ## The incomplete case is the point of this component
 *
 * `consolidateRound` reports `points: null` and `rank: null` on **every** row while
 * any judge is outstanding — not just the unfinished rows (non-negotiable 4). A
 * table that quietly rendered those nulls as blanks would look like a board that
 * had been ranked and lost its numbers, so the incomplete state is announced above
 * the table and each null cell is an em dash with the reason attached.
 *
 * That is also why `ranksByJudge` is still shown when incomplete: seeing who has
 * filed what is exactly how an admin chases the missing judge. Showing one judge's
 * ranks is safe; adding them up across a partial panel is not.
 */
export function BoardTable({
  board,
  judgeNames,
  emptyMessage,
}: {
  board: ConsolidatedBoard;
  /** Judge id → display name, surname-first. A missing id falls back to its seat. */
  judgeNames: Record<string, string>;
  emptyMessage: string;
}) {
  const progress = boardProgress(board);
  const columns = 1 + board.judgeIds.length + 2;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {ROUND_LABEL[board.round]}
          {board.complete ? (
            <Badge variant="secondary" className="text-[10px]">
              Complete
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              Not ranked
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{ROUND_SCOPE[board.round]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {board.complete ? null : (
          <Alert>
            <AlertTitle>This board is not ranked</AlertTitle>
            <AlertDescription>
              {board.judgeIds.length === 0
                ? "No judge is assigned to this event, so there is no panel to consolidate. A board summed over an empty panel would give every contestant nought points and therefore joint first place."
                : board.rows.length === 0
                  ? "This event has no contestants in this round, so there is nothing to rank."
                  : `${progress.filled} of ${progress.expected} ranks are on file and ${progress.judgesDone} of ${board.judgeIds.length} judges have finished. Points and places stay blank until every judge has ranked every contestant — ranking a partial panel favours whichever contestant the absent judge had not reached.`}
            </AlertDescription>
          </Alert>
        )}

        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Code</TableHead>
                {board.judgeIds.map((judgeId, index) => (
                  <TableHead key={judgeId} className="text-right whitespace-nowrap">
                    {judgeNames[judgeId] ?? `Seat ${index + 1}`}
                  </TableHead>
                ))}
                <TableHead className="text-right whitespace-nowrap">Points</TableHead>
                <TableHead className="text-right">Rank</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.rows.length === 0 ? (
                <JudgingEmptyRow colSpan={columns}>{emptyMessage}</JudgingEmptyRow>
              ) : (
                board.rows.map((row) => (
                  <TableRow key={row.unitKey}>
                    <TableCell className="font-mono font-medium tabular-nums">
                      {row.code}
                    </TableCell>
                    {board.judgeIds.map((judgeId) => {
                      const rank = row.ranksByJudge[judgeId];
                      return (
                        <TableCell key={judgeId} className="text-right tabular-nums">
                          {rank === undefined ? (
                            <span title="This judge has not ranked this contestant yet.">
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">Not ranked yet</span>
                            </span>
                          ) : (
                            rank
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right tabular-nums">
                      {row.points ?? (
                        <span title="Points are withheld until every judge has ranked every contestant.">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">
                            Withheld until the panel is complete
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.rank ?? (
                        <span title="No place is given until every judge has ranked every contestant.">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">
                            Withheld until the panel is complete
                          </span>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
