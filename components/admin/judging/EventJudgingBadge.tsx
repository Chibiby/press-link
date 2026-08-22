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
    <Badge variant={STATUS_VARIANT[status]} className="gap-1 text-[10px]">
      {status === "locked" ? <Lock className="size-3" /> : null}
      {status === "not-started" ? <CircleDashed className="size-3" /> : null}
      {EVENT_JUDGING_LABEL[status]}
    </Badge>
  );
}

/**
 * The one empty row every judging table uses.
 *
 * `py-10 text-muted-foreground` is the spacing the entries, participants, coaches
 * and school-papers tables already use for "nothing here", copied rather than
 * re-chosen so an empty judging table sits at the same height as an empty roster
 * one. Their `text-center` is deliberately *not* copied — see below.
 *
 * ## Why the message is capped, wrapped and left-aligned
 *
 * The message is the only thing in these tables today, and a cell spanning every
 * column will happily lay a 75-character sentence out on one line — about 480px,
 * which is wider than a phone. Inside the table's `overflow-x-auto` that does not
 * clip, it *scrolls*: the reader has to drag sideways to finish reading why the
 * table is empty.
 *
 * Three classes fix that, and each answers a different half of it:
 *
 * - `whitespace-normal`, because `TableCell` sets `whitespace-nowrap` in its base
 *   class and `white-space` is inherited. Without it the cap clamps the box while
 *   the text runs straight out of the side — worse than not capping at all.
 * - `max-w-[34ch]`, in `ch` rather than a percentage: a percentage resolves
 *   against the table's own scroll width rather than the screen, so it caps
 *   nothing on exactly the narrow screens that need capping.
 * - no `mx-auto`, and no `text-center`. A spanning cell is as wide as the table,
 *   and the table is as wide as its `whitespace-nowrap` header row — around 650px
 *   for the nine-column panel table. Centring inside *that* puts the start of the
 *   sentence a couple of hundred pixels into the horizontal scroll on a 320px
 *   phone, so the reader meets an apparently blank table body and has to drag
 *   right to find the explanation. Left-aligned, it starts where the scroll does.
 *
 * `text-balance` is kept for evenly filled lines, not for wrapping. It happens to
 * reset `text-wrap-mode` on engines that implement `white-space` as a shorthand,
 * but leaning on that would silently unwrap the sentence on an engine that does
 * not, which is why the wrap is stated outright.
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
      <TableCell colSpan={colSpan} className="py-10 text-muted-foreground">
        <span className="block max-w-[34ch] whitespace-normal text-balance">{children}</span>
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
