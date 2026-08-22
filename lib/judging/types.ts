/**
 * The shared vocabulary of judging and tabulation.
 *
 * Every module in `lib/judging` imports from here and adds nothing to it. That
 * rule is what keeps the pure core from splintering: `consolidate.ts` and
 * `standings.ts` are separate files because they answer separate questions, not
 * because they hold separate ideas of what a unit or a rank is.
 *
 * See `docs/superpowers/specs/2026-08-21-judging-and-tabulation-design.md`.
 * Where a comment here cites D1..D4, it is citing a decision taken by the
 * division office and recorded there.
 */

/** Round 1 covers everyone; round 2 covers the qualifiers. There is no round 3. */
export type JudgingRound = 1 | 2;

/**
 * One ranked thing in one event.
 *
 * An individual event ranks each contestant separately — a school may enter
 * three and each gets a place — so the unit is the participant. A group event
 * ranks the team, so `participantId` is null and the entry is the unit.
 */
export interface ContestUnit {
  /**
   * `participantId` when there is one, otherwise `entryId`. This is the identity
   * a judge's rank is keyed on, what the qualifier set holds, and what joins the
   * anonymous board to the identified one. Nothing else may be used as the key:
   * `entryId` alone collides across an individual event's three contestants.
   */
  unitKey: string;
  /** The 4-digit code, and the only thing about this unit a judge ever sees. */
  code: string;
  entryId: string;
  /** null for a group event, where the team is the unit. */
  participantId: string | null;
}

/** One judge's placement of one unit, as stored in `judge_ranks`. */
export interface JudgeRank {
  judgeId: string;
  unitKey: string;
  rank: number;
}

/**
 * A judge's sheet for one round of one event.
 *
 * `submittedAt` is the lock: the division's rule is "once naka rank, i-lock",
 * so submitting **is** locking and there is no separate locked flag to fall out
 * of step with it.
 */
export interface JudgeSheet {
  judgeId: string;
  round: JudgingRound;
  /** null = open and editable. Set = submitted, and therefore locked. */
  submittedAt: string | null;
}

/** One unit's line on a consolidated board for one round. */
export interface BoardRow {
  unitKey: string;
  code: string;
  entryId: string;
  participantId: string | null;
  /**
   * The sum of the ranks the judges gave (D1). null when the panel is
   * incomplete — see `ConsolidatedBoard.complete`.
   */
  points: number | null;
  /**
   * Competition placement of `points`, ascending: 1, 2, 2, 4. null when the
   * panel is incomplete, because ranking a partial panel would publish a
   * placement the missing judge can still change.
   */
  rank: number | null;
  /** Each judge's own rank, keyed by judge id. A missing key means not yet ranked. */
  ranksByJudge: Record<string, number>;
}

/** One judge-and-unit pair that is still outstanding. */
export interface MissingRank {
  judgeId: string;
  unitKey: string;
  code: string;
}

/**
 * A round's standings across the whole panel.
 *
 * `complete` is load-bearing, not advisory. An incomplete board reports
 * `rank: null` on every row (non-negotiable 4), so a caller cannot accidentally
 * rank over the judges who happened to have finished.
 */
export interface ConsolidatedBoard {
  round: JudgingRound;
  /** Ordered by rank when complete, otherwise by code. */
  rows: BoardRow[];
  /** The panel this board was consolidated over, in seat order. */
  judgeIds: string[];
  complete: boolean;
  /** Empty when `complete`. What is outstanding, so a page can name it. */
  missing: MissingRank[];
}

/** A unit that advanced to round 2, as stored in `round2_qualifiers`. */
export interface QualifierRow {
  unitKey: string;
  code: string;
  entryId: string;
  participantId: string | null;
  round1Points: number;
  round1Rank: number;
}

/**
 * One unit's official placement, per D4: round 2 alone decides the winners.
 *
 * A non-qualifier carries null round-2 figures and sits in a block below every
 * qualifier. `finalRank` is null while the deciding round is incomplete.
 */
export interface StandingRow {
  unitKey: string;
  code: string;
  entryId: string;
  participantId: string | null;
  qualified: boolean;
  round1Points: number | null;
  round1Rank: number | null;
  round2Points: number | null;
  round2Rank: number | null;
  /**
   * `round1Rank + round2Rank`, null if either is missing.
   *
   * **Informational.** The division asked for the column and D4 means it
   * decides nothing: do not sort by it, do not break a tie with it, do not call
   * it official. Every surface that prints it must say so (non-negotiable 6).
   */
  totalRank: number | null;
  /** The official placement. Qualifiers by round 2, non-qualifiers beneath them. */
  finalRank: number | null;
}

/**
 * The identity behind a code — everything a judge must never see, and
 * everything a tabulator must.
 */
export interface UnitIdentity {
  unitKey: string;
  /** Surname-first, via `lib/roster/names`. null for a group unit, which has no one name. */
  name: string | null;
  /** Surname-first, in the order the entry names them. */
  coaches: string[];
  /** The paper for this event's level and language; null when the school filed none. */
  schoolPaper: string | null;
  schoolName: string;
  districtName: string;
}

/** A standing joined to its identity: one row of the tabulators' sheet. */
export interface TabulationRow extends StandingRow, Omit<UnitIdentity, "unitKey"> {}

/**
 * How far through judging an event is.
 *
 * A closed set of names rather than a handful of booleans, because the booleans
 * were being re-combined differently on each surface. `round1-awaiting-close`
 * and `round2-awaiting-lock` are the states where the panel is done and an admin
 * has to act; they are separate from `open` precisely so a page can say so.
 */
export type EventJudgingStatus =
  | "not-started"
  | "round1-open"
  | "round1-awaiting-close"
  | "round2-open"
  | "round2-awaiting-lock"
  | "locked";

export interface EventJudgingState {
  status: EventJudgingStatus;
  /** A sentence a page prints verbatim, so no two surfaces word the same state differently. */
  reason: string;
}

/** What this judge may do with this round's sheet right now. */
export type JudgeSheetAccess = "edit" | "view" | "unavailable";

export interface JudgeSheetState {
  access: JudgeSheetAccess;
  /** Why — printed verbatim, including on the happy path. */
  reason: string;
}

/**
 * `event_rounds` for one event: which admin actions have and have not happened.
 */
export interface EventRoundState {
  round1ClosedAt: string | null;
  /**
   * The cut in force when round 1 was closed. Recorded separately from
   * `events.round2_cut` because the live column may not move once a qualifier
   * list exists, but a historical read must still know what produced that list.
   */
  round2CutUsed: number | null;
  resultsLockedAt: string | null;
}
