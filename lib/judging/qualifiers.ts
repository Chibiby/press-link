import type { ConsolidatedBoard, ContestUnit, QualifierRow } from "./types";

/**
 * The cut an event uses when nobody has set one — `events.round2_cut`'s default
 * in migration 0018. Kept here as well so a pure caller and a test can reason
 * about the rule without a database.
 */
export const DEFAULT_ROUND2_CUT = 10;

/**
 * Who advances to round 2 (D3).
 *
 * The rule is one comparison — `round1Rank <= cut` — and it lives here, once. Not
 * in SQL, not in a page (non-negotiable 3), because round 2's unit list, the
 * judge's sheet, the admin panel's qualifier count and the export all have to
 * agree about a field whose size is not always `cut`.
 *
 * ## Why the field can be larger than the cut
 *
 * Round 1 uses competition ranking, so a three-way tie for 10th place produces
 * three rows all reading rank 10. All three satisfy `<= 10` and **twelve
 * contestants qualify under a cut of ten.** That is the correct outcome, not an
 * overflow to be trimmed: the three are level on points, and there is no fact in
 * round 1 that separates them. Cutting to exactly ten would have to break the tie
 * on something — code order, entry order, whichever row the database returned
 * first — and that is a coin toss deciding who competes for the title.
 *
 * The field can equally be *smaller* than the cut, when the event has fewer
 * contestants than the cut allows.
 *
 * ## An incomplete round 1 qualifies nobody
 *
 * No branch handles this: an incomplete board reports `rank: null` on every row
 * (non-negotiable 4), and `null` passes no comparison. So a caller who forgets to
 * check `board.complete` gets an empty field rather than a field drawn from half
 * the panel's opinion. Callers should still check, because an empty field and
 * "round 1 is not finished" are different things to say on screen.
 */
export function selectQualifiers(board: ConsolidatedBoard, cut: number): QualifierRow[] {
  // A cut of zero or less admits nobody. Guarded rather than trusted so a
  // mis-set event cannot produce negative-rank comparisons downstream.
  if (cut < 1) return [];

  return board.rows
    .filter((row) => row.rank !== null && row.points !== null && row.rank <= cut)
    .map((row) => ({
      unitKey: row.unitKey,
      code: row.code,
      entryId: row.entryId,
      participantId: row.participantId,
      round1Points: row.points as number,
      round1Rank: row.rank as number,
    }))
    .sort((a, b) => a.round1Rank - b.round1Rank || a.code.localeCompare(b.code));
}

/**
 * The qualifiers as a unit set, ready to hand to `consolidateRound` for round 2.
 *
 * Round 2's board is built from this and nothing else, which is the mechanism
 * behind "round 2 is qualifiers only": a non-qualifier is not absent from the
 * sheet by a filter in the page, it was never in the round's unit set.
 */
export function qualifierUnits(qualifiers: QualifierRow[]): ContestUnit[] {
  return qualifiers.map((row) => ({
    unitKey: row.unitKey,
    code: row.code,
    entryId: row.entryId,
    participantId: row.participantId,
  }));
}

/**
 * A sentence explaining a qualifying field that is not the size of the cut, or
 * null when the field needs no explanation.
 *
 * A judge who opens round 2 under a cut of 10 and counts twelve rows will assume
 * something is broken. Written here rather than in the page so the judge portal,
 * the admin panel and the export give the same explanation.
 */
export function qualifierNotice(qualifiers: QualifierRow[], cut: number): string | null {
  if (qualifiers.length === cut) return null;

  if (qualifiers.length > cut) {
    const tied = qualifiers.filter((row) => row.round1Rank === cut).length;
    const shared =
      tied > 1
        ? ` ${tied} contestants are level on rank ${cut}, and a tie cannot be broken by round 1.`
        : "";
    return `${qualifiers.length} qualify under a cut of ${cut}.${shared}`;
  }

  return `${qualifiers.length} qualify — fewer than the cut of ${cut}, because the event has no more contestants.`;
}
