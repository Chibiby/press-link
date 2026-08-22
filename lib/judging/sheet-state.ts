import { boardProgress } from "./consolidate";
import type {
  ConsolidatedBoard,
  EventJudgingState,
  EventJudgingStatus,
  EventRoundState,
  JudgeSheetState,
  JudgingRound,
} from "./types";

/** Short label for a status badge. */
export const EVENT_JUDGING_LABEL: Record<EventJudgingStatus, string> = {
  "not-started": "Not started",
  "round1-open": "Round 1 open",
  "round1-awaiting-close": "Round 1 complete",
  "round2-open": "Round 2 open",
  "round2-awaiting-lock": "Round 2 complete",
  locked: "Locked",
};

/**
 * Where an event has got to, and the sentence to print under the badge.
 *
 * Derived from two facts — what the admin has done (`EventRoundState`) and what
 * the panel has done (the two boards) — because either alone is ambiguous. A
 * closed round 1 with an incomplete round 2 and an open round 1 with an
 * incomplete round 1 are different states that would otherwise both read
 * "waiting".
 *
 * The two "awaiting" states are the ones worth separating: a panel that has
 * finished is not the same as a round that has been closed. Round 1 closing is
 * what draws the qualifiers, and locking is what publishes the results — both are
 * deliberate admin acts, and a judge finishing their last rank must not trigger
 * either by accident.
 */
export function eventJudgingStatus(input: {
  rounds: EventRoundState;
  round1: ConsolidatedBoard;
  round2: ConsolidatedBoard;
}): EventJudgingState {
  const { rounds, round1, round2 } = input;

  if (rounds.resultsLockedAt !== null) {
    return {
      status: "locked",
      reason: "Results are locked. Unlock them before any rank can change.",
    };
  }

  if (rounds.round1ClosedAt === null) {
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

    const progress = boardProgress(round1);
    if (round1.complete) {
      return {
        status: "round1-awaiting-close",
        reason: "Every judge has ranked round 1. Close round 1 to draw the qualifiers.",
      };
    }
    if (progress.filled === 0) {
      return {
        status: "not-started",
        reason: `No ranks filed yet by any of the ${round1.judgeIds.length} assigned judges.`,
      };
    }
    return {
      status: "round1-open",
      reason: `Round 1 is open — ${progress.filled} of ${progress.expected} ranks filed, ${progress.judgesDone} of ${round1.judgeIds.length} judges finished.`,
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
 * 1. **Assignment first.** An unassigned judge must not learn whether an event
 *    exists, is open, or is locked. Every later reason leaks something about the
 *    event, so this returns before any of them can.
 * 2. **Round 2 before locking.** "Round 2 has not opened" is more useful than
 *    "results are locked" to a judge looking at a round that never ran.
 * 3. **Locked before closed, closed before submitted** — outermost fact first, so
 *    the reason names the thing the judge would have to get changed.
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
  /** When this judge submitted this round's sheet, or null. */
  submittedAt: string | null;
}): JudgeSheetState {
  const { round, rounds, assigned, submittedAt } = input;

  if (!assigned) {
    return {
      access: "unavailable",
      reason: "You are not assigned to this event.",
    };
  }

  if (round === 2 && rounds.round1ClosedAt === null) {
    return {
      access: "unavailable",
      reason: "Round 2 opens once round 1 is closed and the qualifiers are drawn.",
    };
  }

  if (rounds.resultsLockedAt !== null) {
    return {
      access: "view",
      reason: "Results are locked. Your sheet is final.",
    };
  }

  if (round === 1 && rounds.round1ClosedAt !== null) {
    return {
      access: "view",
      reason: "Round 1 is closed. The qualifiers have been drawn from these ranks.",
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
