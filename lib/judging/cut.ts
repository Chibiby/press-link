import type { ConsolidatedBoard, ContestUnit, JudgeRank, QualifierRow } from "./types";

/**
 * Round 1: the cut.
 *
 * `consolidate.ts` cannot express this round. It reads an unranked unit as an
 * incomplete panel and refuses to rank anything (non-negotiable 4), which is
 * right for round 2 and wrong here: in round 1 an unranked unit is not a missing
 * opinion, it is an **elimination** (N2). One judge scores the top `cut` and
 * leaves everyone else blank, and blank is a final answer.
 *
 * See `docs/superpowers/specs/2026-08-27-judges-portal-two-stage-ranking-design.md`.
 * N-numbers below cite decisions recorded there.
 */

/**
 * The cut an event uses when nobody has set one — `events.round2_cut`'s default
 * in migration 0018. Kept here as well so a pure caller and a test can reason
 * about the rule without a database.
 */
export const DEFAULT_ROUND2_CUT = 10;

/** One unit's line on round 1's board. */
export interface Round1Row {
  unitKey: string;
  code: string;
  entryId: string;
  participantId: string | null;
  /**
   * The judge's typed rank, **verbatim** (N3). Ties stand as typed: 1, 2, 2, 3
   * stays 1, 2, 2, 3 and is not renumbered to 1, 2, 2, 4. Round 1 selects a
   * field; the exact placements inside it decide nothing on their own, and
   * renumbering would silently move a contestant the judge deliberately levelled.
   *
   * `null` is a blank — eliminated, not outstanding.
   */
  rank: number | null;
  /**
   * Only set when the row came from a consolidated panel board, where points and
   * rank are different numbers. Round 1 proper has one judge, so its points and
   * its rank are the same figure and this stays absent.
   */
  points?: number | null;
  /**
   * Each judge's own rank, present for the same reason `points` is: a
   * consolidated panel board carries it and this row type has to be able to hold
   * a board of either shape.
   *
   * It is what lets `eventJudgingStatus` quote progress on a panel board, where
   * `rank` is null on every row until the last judge finishes (non-negotiable 4)
   * and so cannot say how much has been typed.
   */
  ranksByJudge?: Record<string, number>;
}

/** Round 1's board: one judge's opinion of the whole field. */
export interface Round1Board {
  round: 1;
  /** The seat-1 judge, or null when nobody has ranked anything. */
  judgeId: string | null;
  /** Ordered by rank, then by code inside a tie; blanks last, by code. */
  rows: Round1Row[];
  /**
   * How many rows carry a rank — that is, how many the judge did not eliminate.
   * Not the qualifier count: a judge may rank past the cut, and `round1Qualifiers`
   * is what applies the cut to these rows.
   */
  scored: number;
}

/**
 * The least a board must be for the cut rule to read it.
 *
 * Stated as a structural minimum rather than as `Round1Board` so the same rule
 * can also read a `ConsolidatedBoard` — see {@link selectQualifiers}. One
 * implementation of the cut, two shapes of input (non-negotiable 3).
 */
export interface Round1Field {
  rows: readonly Round1Row[];
}

/**
 * Round 1's board from one judge's ranks (N2, N3).
 *
 * `ranks` is the seat-1 judge's sheet. A rank for a unit not in this event is
 * dropped — an entry may have been deleted since the sheet was filed — and a
 * duplicate rank for the same unit keeps the **first**, so two reads of the same
 * data cannot produce two different boards. Nothing is summed and nothing is
 * renumbered: what the judge typed is what the row carries.
 */
export function round1Board(units: ContestUnit[], ranks: JudgeRank[]): Round1Board {
  const rankByUnit = new Map<string, number>();
  let judgeId: string | null = null;

  const known = new Set(units.map((unit) => unit.unitKey));
  for (const rank of ranks) {
    if (!known.has(rank.unitKey)) continue;
    if (rankByUnit.has(rank.unitKey)) continue;
    rankByUnit.set(rank.unitKey, rank.rank);
    judgeId ??= rank.judgeId;
  }

  const rows: Round1Row[] = units.map((unit) => ({
    unitKey: unit.unitKey,
    code: unit.code,
    entryId: unit.entryId,
    participantId: unit.participantId,
    rank: rankByUnit.get(unit.unitKey) ?? null,
  }));

  // Blanks sort last rather than as rank 0: they are eliminated, and floating
  // them above the field they lost to is the one ordering a screen must never
  // show.
  rows.sort(
    (a, b) =>
      (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY) ||
      a.code.localeCompare(b.code)
  );

  return {
    round: 1,
    judgeId,
    rows,
    scored: rows.filter((row) => row.rank !== null).length,
  };
}

/**
 * Who advances to round 2 (D3, N2, N3).
 *
 * **The qualifier set is the scored rows at or above the cut.** `rank <= cut` is
 * the whole rule and it is load-bearing, not defensive: round 1's dropdown is
 * bounded by the field rather than by the cut (see `ROUND1_RANK_LIMIT`), so a
 * judge may deliberately rank fifteen under a cut of ten, and the eleventh
 * onwards are scored, placed and not qualified. The same comparison also covers
 * an admin lowering `events.round2_cut` after a sheet was filed: a rank above the
 * new cut stops qualifying rather than sneaking through on the strength of having
 * been legal once.
 *
 * ## Why the field can be larger than the cut
 *
 * Ties are legal (N3). Three contestants sharing rank 10 all satisfy `<= 10`, so
 * **a cut of ten sends twelve to round 2.** That is the correct outcome, not an
 * overflow to be trimmed: the three are level, and there is no fact in round 1
 * that separates them. Cutting to exactly ten would have to break the tie on
 * code order or on whichever row the database returned first, and that is a coin
 * toss deciding who competes for the title. `qualifierNotice()` writes the
 * sentence that explains the count on screen.
 *
 * The field can equally be *smaller* than the cut, when the event has fewer
 * contestants than the cut allows, or when the judge scored fewer.
 */
export function round1Qualifiers(board: Round1Field, cut: number): QualifierRow[] {
  // A cut of zero or less admits nobody. Guarded rather than trusted so a
  // mis-set event cannot produce negative-rank comparisons downstream.
  if (cut < 1) return [];

  return board.rows
    .filter((row): row is Round1Row & { rank: number } => row.rank !== null && row.rank <= cut)
    .map((row) => ({
      unitKey: row.unitKey,
      code: row.code,
      entryId: row.entryId,
      participantId: row.participantId,
      // One judge, so the round's points and its rank are the same number. A
      // consolidated board arriving through `selectQualifiers` carries a real
      // sum and keeps it.
      round1Points: row.points ?? row.rank,
      round1Rank: row.rank,
    }))
    .sort((a, b) => a.round1Rank - b.round1Rank || a.code.localeCompare(b.code));
}

/**
 * The cut applied to a consolidated panel board.
 *
 * The pre-N1 shape, kept for the surfaces that still consolidate round 1 over a
 * panel — the admin event index reads every event, including group events, whose
 * model this feature does not touch (non-negotiable 6). It is a call through to
 * {@link round1Qualifiers} and not a second implementation: an incomplete board
 * reports `rank: null` on every row (non-negotiable 4), and `null` is read here
 * as "no rank", so an unfinished panel qualifies nobody.
 */
export function selectQualifiers(board: ConsolidatedBoard, cut: number): QualifierRow[] {
  return round1Qualifiers(board, cut);
}
