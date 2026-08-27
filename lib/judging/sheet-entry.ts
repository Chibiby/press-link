/**
 * Whether an admin may encode one judge's sheet from paper, and why not (N9).
 *
 * The admin counterpart to `judgeSheetState`, which answers the same question for
 * the judge's own screen. Two functions rather than one because the *sentences*
 * differ, and the sentences are most of the point: `judgeSheetState` speaks in the
 * second person to the judge who is blocked ("You ranked round 1"), and an admin
 * reading that about somebody else would be told the wrong thing about themselves.
 * The rules they check are the same rules, and both are checked again inside
 * `judging_write_sheet`, which is the actual boundary (non-negotiable 2).
 *
 * Pure and tested, like `event-controls`, so what the console offers is settled here
 * rather than in a reading of a page.
 */

import { ROUND1_SEAT, ROUND2_SEATS } from "./sheet-state";
import type { EventRoundState, JudgingRound } from "./types";

/** What the console knows about one seat's sheet when it draws the control. */
export interface SheetEntryFacts {
  /**
   * Whether the two-stage rounds apply. A group event is ranked on one board and
   * has no seats (non-negotiable 6); `judging_write_sheet` refuses it first of all.
   */
  individual: boolean;
  /** The seat this judge holds on this event, or null when they hold none. */
  seat: number | null;
  /** The round being encoded, which is the seat's round (N1). */
  round: JudgingRound;
  rounds: EventRoundState;
  /**
   * When this judge submitted this round's sheet, or null.
   *
   * Writing a sheet *is* submitting it, so a sheet already in cannot be typed over:
   * an admin reopens it first (`admin_unlock_judge_sheet`), which is an attributed
   * act and leaves the ranks in place to be corrected rather than retyped.
   */
  submittedAt: string | null;
}

export interface SheetEntryState {
  canEnter: boolean;
  /** One sentence: the invitation when it is allowed, the obstacle when it is not. */
  reason: string;
}

/**
 * The one control, decided.
 *
 * The order of the checks is the order the obstacles have to be cleared in, so an
 * admin who acts on the sentence they are given never has to come back and read a
 * second one they could have been told about first. The seat rules come before the
 * round's state for a different reason: a seat that cannot rank this round at all is
 * not blocked by the round being open or shut, and saying so would misdescribe it.
 */
export function sheetEntryState(facts: SheetEntryFacts): SheetEntryState {
  const { individual, seat, round, rounds, submittedAt } = facts;

  if (!individual) {
    return {
      canEnter: false,
      reason: "This is a group event. The two-stage rounds cover individual events only.",
    };
  }

  if (seat === null) {
    return { canEnter: false, reason: "This seat is empty, so there is no sheet to enter." };
  }

  if (round === 1 && seat !== ROUND1_SEAT) {
    return { canEnter: false, reason: "Round 1 is seat 1's sheet alone." };
  }

  if (round === 2 && !ROUND2_SEATS.includes(seat)) {
    return { canEnter: false, reason: "Round 2 is ranked by seats 2, 3 and 4." };
  }

  // Before the per-round locks, because it shuts both rounds and an admin told to
  // reopen round 1 would find that refused too, for this reason.
  if (rounds.resultsLockedAt !== null) {
    return {
      canEnter: false,
      reason: "This event's results are published. Unlock them before changing any sheet.",
    };
  }

  if (round === 1 && rounds.round1LockedAt !== null) {
    return {
      canEnter: false,
      reason: "Round 1 is closed and its qualifiers are drawn. Reopen round 1 first.",
    };
  }

  if (round === 2 && rounds.round1LockedAt === null) {
    return {
      canEnter: false,
      reason: "Round 2 has no field yet. Close round 1 first to draw the qualifiers.",
    };
  }

  if (submittedAt !== null) {
    return {
      canEnter: false,
      reason: "This sheet is already submitted. Reopen it to correct what was entered.",
    };
  }

  return {
    canEnter: true,
    reason: "Type the ranks from this judge's paper sheet. Saving submits and locks it.",
  };
}
