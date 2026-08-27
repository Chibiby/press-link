import type { ContestUnit, QualifierRow } from "./types";

/**
 * What happens to a qualifying field once it exists: round 2's unit set, and the
 * sentence that explains a field whose size is not the cut.
 *
 * **Drawing** the field is no longer here. Round 1 is one judge's typed ranks
 * with blanks (N1, N2), not a consolidated panel board, so `selectQualifiers` and
 * `DEFAULT_ROUND2_CUT` moved to `cut.ts` with the rest of the cut rule — one
 * implementation, in the file named after it (non-negotiable 3).
 */

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
