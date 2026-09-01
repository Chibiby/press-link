import { MAX_ROUND2_CUT } from "./cut";
import type { EventIndexRow } from "./event-index";
import type { EventJudgingStatus } from "./types";

/**
 * Raising an event's cut to the number its judge actually ranked, so that nobody
 * who was placed in round 1 is left out of round 2.
 *
 * ## The situation this exists for
 *
 * Since migration 0032 a round-1 judge ranks as far down the field as they mean to
 * and the cut decides who advances. The two numbers are therefore free to disagree,
 * and when the cut is the smaller one the difference is a contestant the judge
 * placed and the round eliminated. That is a legitimate outcome — it is what a cut
 * is — but it is not always the one the office intended, and on a round already
 * closed it is invisible until somebody counts the exported sheet.
 *
 * This finds those events and says how far apart the two numbers are.
 *
 * ## Why it does not touch an event whose cut is merely larger
 *
 * A cut of 30 over a field of 20 ranked already lets all twenty through. Setting it
 * to 20 would record a tidier number and change nothing about who competes — while
 * costing, on a closed round, a reopen and a re-lock. Churn on a published round for
 * no change in outcome is a bad trade, so the plan leaves those alone and counts
 * them as already letting everyone through.
 *
 * Nothing here writes. `bulkCutPlan` decides what a run *would* do; the action
 * drives the same per-event RPCs the panel page does, and each re-checks its own
 * rule (non-negotiable 2).
 */

/** Statuses in which round 1 has been closed and its qualifier list drawn. */
const AFTER_ROUND1_LOCK: readonly EventJudgingStatus[] = [
  "round2-open",
  "round2-awaiting-lock",
  "locked",
];

export interface BulkCutStep {
  eventId: string;
  eventName: string;
  /** The seat 1 judge whose sheet has to be re-submitted under the new cut. */
  judgeId: string;
  /** `events.round2_cut` as it stands. */
  from: number | null;
  /** What it becomes: the number this judge ranked. */
  to: number;
  /** How many are on the qualifier list today. Zero while round 1 is open. */
  qualifiers: number;
  /**
   * Whether round 1 is closed, and so whether fixing this event means reopening it
   * and closing it again. The dialog says so before the click, because a reopen
   * discards the qualifier list and redraws it — the same list, plus the people the
   * old cut kept out.
   */
  wasLocked: boolean;
}

export interface BulkCutSkip {
  eventId: string;
  eventName: string;
  reason: string;
}

export interface BulkCutPlan {
  steps: BulkCutStep[];
  skipped: BulkCutSkip[];
  /** Events whose cut already admits everyone their judge ranked. */
  unchanged: number;
}

/**
 * Which events have a cut standing below what their judge ranked.
 *
 * The comparison changes with the round's state, and it has to. While round 1 is
 * open there is no qualifier list, so the question is what the *next* lock would
 * draw — the live cut against the ranked count. Once round 1 is closed the list
 * exists and is the only thing that matters: an event locked under an old cut of 15
 * has fifteen qualifiers however large `events.round2_cut` has grown since, and
 * reading the live column there would report it as fixed when it is not.
 *
 * Group events are left out entirely rather than listed as refused. They have no
 * cut and no round to close (non-negotiable 6), and thirty-odd rows saying so would
 * bury the handful of events this is about.
 */
export function bulkCutPlan(rows: EventIndexRow[]): BulkCutPlan {
  const steps: BulkCutStep[] = [];
  const skipped: BulkCutSkip[] = [];
  let unchanged = 0;

  for (const row of rows) {
    // `round1Cut` is null for exactly the group events.
    if (row.round1Cut === null) continue;

    const name = `${row.typeNameEn} · ${row.slotLabel}`;
    const scored = row.round1Cut.scored;
    const judgeId = row.round1Cut.judgeId;
    const wasLocked = AFTER_ROUND1_LOCK.includes(row.state.status);
    const qualifiers = row.round2.rows.length;

    if (scored === 0 || judgeId === null) {
      // Not a fault and not worth a line in the skipped list: most of the catalog
      // is unranked most of the time.
      unchanged += 1;
      continue;
    }

    const shortfall = wasLocked ? qualifiers < scored : (row.round2Cut ?? 0) < scored;
    if (!shortfall) {
      unchanged += 1;
      continue;
    }

    if (row.state.status === "locked") {
      skipped.push({
        eventId: row.eventId,
        eventName: name,
        reason: `${scored} were ranked and ${qualifiers} qualified, but the results are published. Unlock the results first — this cannot move a standing that has been declared.`,
      });
      continue;
    }

    // Round 2 work is destroyed by reopening round 1 (N8), and this feature is not
    // the place to spend it. The office can still fix such an event by hand, having
    // decided what the round 2 ranks are worth.
    const round2Ranked = row.round2.rows.some(
      (boardRow) => Object.keys(boardRow.ranksByJudge).length > 0
    );
    if (round2Ranked) {
      skipped.push({
        eventId: row.eventId,
        eventName: name,
        reason: `${scored} were ranked and ${qualifiers} qualified, but round 2 has already been ranked. Raising the cut reopens round 1, which discards every round 2 sheet — do this one by hand if it is worth it.`,
      });
      continue;
    }

    if (scored > MAX_ROUND2_CUT) {
      skipped.push({
        eventId: row.eventId,
        eventName: name,
        reason: `${scored} were ranked, which is more than the largest cut an event may carry (${MAX_ROUND2_CUT}).`,
      });
      continue;
    }

    steps.push({
      eventId: row.eventId,
      eventName: name,
      judgeId,
      from: row.round2Cut,
      to: scored,
      qualifiers,
      wasLocked,
    });
  }

  return { steps, skipped, unchanged };
}

/** What a finished run says. */
export function bulkCutSummary(input: {
  changed: number;
  failed: number;
  unchanged: number;
}): string {
  const { changed, failed, unchanged } = input;
  const parts = [`${changed} ${changed === 1 ? "cut" : "cuts"} raised`];
  if (failed > 0) parts.push(`${failed} refused`);
  parts.push(`${unchanged} already let everyone ranked through`);
  return parts.join(", ") + ".";
}
