import { CircleDashed, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { EVENT_JUDGING_LABEL } from "@/lib/judging/sheet-state";
import type { EventJudgingStatus } from "@/lib/judging/types";

/**
 * How each status is weighted on screen.
 *
 * The two "awaiting" states get the filled badge because they are the only two
 * that are a request: the panel has finished and an admin has to close the round
 * or lock the results. Open rounds are merely in progress, and nobody needs to be
 * called to look at one, so they stay quiet. `not-started` is outlined for the
 * same reason a not-offered contest is an em dash on the events page — an absence
 * should not carry the same visual weight as a state.
 */
const STATUS_VARIANT: Record<
  EventJudgingStatus,
  "default" | "secondary" | "outline"
> = {
  "not-started": "outline",
  "round1-open": "secondary",
  "round1-awaiting-close": "default",
  "round2-open": "secondary",
  "round2-awaiting-lock": "default",
  locked: "secondary",
};

/**
 * An event's judging status, labelled from `EVENT_JUDGING_LABEL`.
 *
 * The label is never composed here. `lib/judging/sheet-state` owns both the status
 * and its wording precisely so the judges page, the tabulators page and a judge's
 * own portal cannot word the same state three ways.
 */
export function EventJudgingBadge({ status }: { status: EventJudgingStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className="gap-1 text-[10px] whitespace-nowrap">
      {status === "locked" ? <Lock className="size-3" /> : null}
      {status === "not-started" ? <CircleDashed className="size-3" /> : null}
      {EVENT_JUDGING_LABEL[status]}
    </Badge>
  );
}

/**
 * The one empty row every judging table uses.
 *
 * `py-10 text-center text-muted-foreground` is the spacing the entries,
 * participants, coaches and school-papers tables already use for "nothing here",
 * copied rather than re-chosen so an empty judging table sits at the same height
 * as an empty roster one.
 *
 * ## Why the message is width-capped
 *
 * The message is the only thing in these tables today, and a cell spanning every
 * column will happily lay a 75-character sentence out on one line — about 480px,
 * which is wider than a phone. Inside the table's `overflow-x-auto` that does not
 * clip, it *scrolls*: the reader has to drag sideways to finish reading why the
 * table is empty. A percentage cap cannot help, because a percentage resolves
 * against the table's own scroll width rather than the screen, so the cap is in
 * `ch` and the sentence wraps to two or three balanced lines instead.
 */
export function JudgingEmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">
        <span className="mx-auto block max-w-[34ch] text-balance">{children}</span>
      </TableCell>
    </TableRow>
  );
}

/**
 * A cell whose value is unavailable because the column does not exist yet.
 *
 * An em dash, not a zero and not a blank — the same decision `tabulationCell`
 * makes for an absent rank, and for the same reason: `0` sorts as a winning place
 * and a blank is indistinguishable from a cell that failed to render. The reason
 * rides along in `title` for a sighted hover and in a screen-reader-only span,
 * which would otherwise hear only the punctuation.
 */
export function NotYetCell({ reason }: { reason: string }) {
  return (
    <span title={reason}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{reason}</span>
    </span>
  );
}
