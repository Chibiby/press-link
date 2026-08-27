import { boardProgress } from "./consolidate";
import type { Round1Row } from "./cut";
import type {
  ConsolidatedBoard,
  EventJudgingState,
  EventJudgingStatus,
  EventRoundState,
  JudgeSheetState,
  JudgingRound,
} from "./types";

/**
 * The seat that cuts the field, and the seats that place the qualifiers (N1).
 *
 * Stated here so a page, a form and `judgeSheetState` cannot disagree about which
 * seat belongs to which round. These mirror `admin_assign_judge`, which refuses any
 * seat outside 1 to 4, and `judge_submit_sheet`, which re-checks the same rule
 * server-side — this pair decides what a page renders, not what may be written
 * (non-negotiable 2).
 */
export const ROUND1_SEAT = 1;
export const ROUND2_SEATS: readonly number[] = [2, 3, 4];

/** Short label for a status badge. */
export const EVENT_JUDGING_LABEL: Record<EventJudgingStatus, string> = {
  "not-started": "Not started",
  "round1-open": "Round 1 open",
  "round1-awaiting-close": "Round 1 submitted",
  "round2-open": "Round 2 open",
  "round2-awaiting-lock": "Round 2 complete",
  locked: "Locked",
};

/**
 * The least of round 1 `eventJudgingStatus` reads.
 *
 * Structural rather than `Round1Board`, so a `ConsolidatedBoard` satisfies it and
 * the admin event index can keep passing one for a group event, whose model this
 * feature does not touch (non-negotiable 6).
 *
 * `complete` for round 1 means **the one judge has submitted** (N1, N6), which is
 * a fact about the sheet and not about the board: a cut leaves most rows blank on
 * purpose (N2), so no count of filled rows can tell you the judge is finished. The
 * caller passes `submittedAt !== null`.
 */
export interface Round1JudgingView {
  rows: readonly Round1Row[];
  /** The judges seated on round 1 — one, under N1. Empty means nobody is seated. */
  judgeIds: string[];
  complete: boolean;
}

/**
 * Where an event has got to, and the sentence to print under the badge.
 *
 * Derived from two facts — what the admin has done (`EventRoundState`) and what
 * the judges have done (the two boards) — because either alone is ambiguous. A
 * locked round 1 with an incomplete round 2 and an open round 1 with an
 * incomplete round 1 are different states that would otherwise both read
 * "waiting".
 *
 * The two rounds are read differently because they are not the same shape (N1):
 * round 1 is one judge cutting the field, round 2 is three judges placing the
 * qualifiers. Only round 2 has a panel to be short of.
 *
 * The two "awaiting" states are the ones worth separating: a panel that has
 * finished is not the same as a round that has been closed. Round 1 closing is
 * what draws the qualifiers, and locking is what publishes the results — both are
 * deliberate admin acts, and a judge finishing their last rank must not trigger
 * either by accident.
 *
 * `round1-awaiting-close` keeps its name from the 2026-08-21 contract, where
 * closing round 1 was the act that drew the qualifiers. Under N6 that act is
 * locking, which is what the label and the reason both say. The status value is
 * left alone deliberately: the spec adds no status values, and renaming this one
 * would churn every surface that switches on it to say the same thing.
 */
export function eventJudgingStatus(input: {
  rounds: EventRoundState;
  round1: Round1JudgingView;
  round2: ConsolidatedBoard;
}): EventJudgingState {
  const { rounds, round1, round2 } = input;

  if (rounds.resultsLockedAt !== null) {
    return {
      status: "locked",
      reason: "Results are locked. Unlock them before any rank can change.",
    };
  }

  if (rounds.round1LockedAt === null) {
    if (round1.judgeIds.length === 0) {
      return {
        status: "not-started",
        reason: "No judge is assigned to this event yet.",
      };
    }
    if (round1.rows.length === 0) {
      return {
        status: "not-started",
        reason: "This event has no entries to rank.",
      };
    }

    // What has been typed, over what a full set of sheets would hold. Not a
    // progress bar towards a finish: round 1 is a cut, so the judge is finished at
    // `cut` ranks with every other row deliberately blank (N2). Only the
    // submission says round 1 is done, which is why this branch reports what has
    // been typed and leaves "complete" to `submittedAt`.
    //
    // Counted off `ranksByJudge` where the row carries it, because a consolidated
    // panel board — what the admin index still passes for a group event
    // (non-negotiable 6) — reports `rank: null` on every row until the last judge
    // finishes (non-negotiable 4). Counting ranks there would report a panel
    // halfway through as one that had not started.
    const filed = round1.rows.reduce(
      (sum, row) =>
        sum +
        (row.ranksByJudge
          ? Object.keys(row.ranksByJudge).length
          : row.rank !== null
            ? 1
            : 0),
      0
    );
    // One judge under N1, so this is the row count; a panel board multiplies it
    // out. The floor of 1 keeps the sentence honest for a board that arrives with
    // ranks but no seats recorded, which the no-judge branch above has already
    // ruled out for the panel this function is given.
    const expected = round1.rows.length * Math.max(round1.judgeIds.length, 1);
    if (round1.complete) {
      return {
        status: "round1-awaiting-close",
        reason: "The round 1 judge has submitted. Lock round 1 to draw the qualifiers.",
      };
    }
    if (filed === 0) {
      return {
        status: "not-started",
        reason: "The round 1 judge has not filed any ranks yet.",
      };
    }
    return {
      status: "round1-open",
      reason: `Round 1 is open — ${filed} of ${expected} ranks filed.`,
    };
  }

  if (round2.complete) {
    return {
      status: "round2-awaiting-lock",
      reason: "Every judge has ranked round 2. Lock the results to publish them.",
    };
  }

  const progress = boardProgress(round2);
  return {
    status: "round2-open",
    reason: `Round 2 is open — ${progress.filled} of ${progress.expected} ranks filed, ${progress.judgesDone} of ${round2.judgeIds.length} judges finished.`,
  };
}

/**
 * Whether this judge may edit this round's sheet, only read it, or not reach it
 * at all.
 *
 * The rule the division asked for is "once naka rank na i lock lang" — a
 * submitted sheet locks. A judge cannot revise a rank after submitting, because
 * a submitted sheet has already fed the consolidated board and may already have
 * drawn the qualifiers. Reversing it is an administrative act with a record
 * (`admin_unlock_judge_sheet`), not a second thought.
 *
 * The order of these checks is the design, not an accident:
 *
 * 1. **Assignment first, then the seat.** An unassigned judge — or one whose seat
 *    does not sit on this round (N1) — must not learn whether an event exists, is
 *    open, or is locked. Every later reason leaks something about the event, so
 *    these return before any of them can.
 * 2. **Round 2 before locking.** "Round 2 has not opened" is more useful than
 *    "results are locked" to a judge looking at a round that never ran.
 * 3. **Locked before locked-round-1, and that before submitted** — outermost fact
 *    first, so the reason names the thing the judge would have to get changed.
 *
 * This decides what a page renders. It is not the authorisation boundary — that
 * is `judge_submit_sheet`, which re-checks assignment and submission server-side
 * (non-negotiable 2). A judge who forges a request past this function still
 * cannot write.
 */
export function judgeSheetState(input: {
  round: JudgingRound;
  rounds: EventRoundState;
  /** Whether this judge sits on this event's panel. */
  assigned: boolean;
  /**
   * This judge's seat, or null when they hold none.
   *
   * The panel is asymmetric (N1): seat 1 cuts the field alone in round 1, seats
   * 2, 3 and 4 place the qualifiers in round 2, and the judge who made the cut
   * does not also place the winners. So a seat is not merely a label on an
   * assignment — it decides which round this judge may reach at all.
   */
  seat: number | null;
  /** When this judge submitted this round's sheet, or null. */
  submittedAt: string | null;
}): JudgeSheetState {
  const { round, rounds, assigned, seat, submittedAt } = input;

  if (!assigned) {
    return {
      access: "unavailable",
      reason: "You are not assigned to this event.",
    };
  }

  // The seat rule comes before every fact about the round, for the same reason
  // assignment does: a judge who does not sit on this round must not learn from
  // the refusal whether it is open, finished or locked.
  if (round === 1 && seat !== ROUND1_SEAT) {
    return {
      access: "unavailable",
      reason: "Round 1 is ranked by one judge, and it is not your seat.",
    };
  }

  if (round === 2 && seat === ROUND1_SEAT) {
    return {
      access: "unavailable",
      reason: "You ranked round 1. Round 2 is placed by the other three judges.",
    };
  }

  if (round === 2 && (seat === null || !ROUND2_SEATS.includes(seat))) {
    // A judge assigned with no seat, or with a seat outside the panel, is a data
    // fault rather than a judge with a wider remit. The safe reading is no access:
    // round 2 is where the winners are placed, and a row the seat rule cannot
    // classify must not be able to write one.
    return {
      access: "unavailable",
      reason: "You hold no seat on this event's round 2 panel.",
    };
  }

  if (round === 2 && rounds.round1LockedAt === null) {
    return {
      access: "unavailable",
      reason: "Round 2 opens once round 1 is locked and the qualifiers are drawn.",
    };
  }

  if (rounds.resultsLockedAt !== null) {
    return {
      access: "view",
      reason: "Results are locked. Your sheet is final.",
    };
  }

  // The lock, not the close (N6). They are set together on a normal lock, but an
  // admin who unlocks round 1 mid-round-2 (N8) clears only the lock — and that
  // unlock exists precisely so this sheet becomes editable again.
  if (round === 1 && rounds.round1LockedAt !== null) {
    return {
      access: "view",
      reason: "Round 1 is locked. The qualifiers have been drawn from these ranks.",
    };
  }

  if (submittedAt !== null) {
    return {
      access: "view",
      reason: "You have submitted this sheet. Ask an administrator to unlock it if a rank must change.",
    };
  }

  return { access: "edit", reason: "Rank every contestant, then submit." };
}

/**
 * Whether a judge may still change this sheet.
 *
 * A one-line reading of {@link judgeSheetState} so a form and a button cannot
 * disagree about which of the three access values means writable.
 */
export function sheetEditable(state: JudgeSheetState): boolean {
  return state.access === "edit";
}
