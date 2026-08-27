import { competitionRank } from "./consolidate";
import { round1Qualifiers, type Round1Field } from "./cut";
import type { ConsolidatedBoard, QualifierRow, StandingRow } from "./types";

/**
 * The official placement of every contestant in one event.
 *
 * See `docs/superpowers/specs/2026-08-27-judges-portal-two-stage-ranking-design.md`.
 * N-numbers cite decisions recorded there; that file supersedes the D-numbers of
 * the 2026-08-21 contract wherever the two disagree.
 */

export interface StandingsInput {
  /**
   * Round 1's board — the field, and who qualified.
   *
   * Typed as the structural minimum the cut rule reads (`Round1Field`) rather
   * than as `Round1Board`, so a consolidated panel board satisfies it too. That
   * is what lets the admin event index keep feeding a `ConsolidatedBoard` here for
   * a group event, whose model this feature does not touch (non-negotiable 6).
   */
  round1: Round1Field & { complete?: boolean };
  /** Round 2's consolidated board, over the qualifiers only. */
  round2: ConsolidatedBoard;
  /** `events.round2_cut`. */
  cut: number;
}

/**
 * The event's standings (N4).
 *
 * ## The final placement is round 1 rank plus round 2 points
 *
 * ```
 * round2Points = the three judges' round 2 ranks, added
 * finalPoints  = round1Rank + round2Points
 * finalRank    = competition placement of finalPoints, ascending (1, 2, 2, 4)
 * ```
 *
 * A genuine tie on `finalPoints` shares the place and the next place is skipped.
 * **There is no further tie-break** — not round 2 alone, not round 1 alone, not
 * code order. Two contestants level on the sum are level, and inventing a
 * separator here would be this module awarding a medal the judges did not.
 *
 * This replaces D4, under which round 2 alone decided and the sum was a column
 * tabulators were warned not to read. The division withdrew that on 2026-08-27:
 * round 1 is now one judge's cut rather than a panel's verdict, so the sum is no
 * longer adding two panels' opinions of two different fields.
 *
 * ## Non-qualifiers
 *
 * They were never scored in round 1 (N2 — blank *is* the answer), so they have no
 * round 1 rank and nothing to add. They carry a null `finalPoints` and **no final
 * rank at all**: eliminated in round 1, not placed in a block beneath the
 * qualifiers the way D4 had them. A non-qualifier that does arrive with a real
 * round 1 rank — which only a consolidated group-event board produces — is
 * reported with that rank and still gets no final placement.
 *
 * ## Incomplete round 2
 *
 * Every final rank is null (non-negotiable 4). A ranking over the judges who
 * happened to have finished is never produced, not even for the rows where the
 * outstanding judge could not change the order.
 */
export function finalStandings({ round1, round2, cut }: StandingsInput): StandingRow[] {
  const qualifiers = round1Qualifiers(round1, cut);
  const qualifierByKey = new Map<string, QualifierRow>(qualifiers.map((q) => [q.unitKey, q]));

  const round2ByKey = new Map(round2.rows.map((row) => [row.unitKey, row]));
  const round2Ready = round2.complete;

  // --- Qualifiers: placed by round 1 rank plus round 2 points. ---------------
  const finalPointsByKey = new Map<string, number>();
  const finalRankByKey = new Map<string, number>();

  if (round2Ready) {
    const scored = qualifiers
      .map((q) => ({
        unitKey: q.unitKey,
        round1Rank: q.round1Rank,
        round2Points: round2ByKey.get(q.unitKey)?.points ?? null,
      }))
      // A qualifier with no round 2 points on a board that reports itself complete
      // would be a bug upstream, not a contestant to place last. Drop it so it
      // falls through to a null final rank and shows as unranked.
      .filter((row): row is typeof row & { round2Points: number } => row.round2Points !== null)
      .map((row) => ({ unitKey: row.unitKey, finalPoints: row.round1Rank + row.round2Points }));

    scored.forEach((row) => finalPointsByKey.set(row.unitKey, row.finalPoints));

    // competitionRank returns places positionally, so nothing is sorted here — and
    // deliberately so: a sort would invite a tie-break to be smuggled in as the
    // comparator's next term, and N4 says there is not one.
    const places = competitionRank(scored.map((row) => row.finalPoints));
    scored.forEach((row, index) => finalRankByKey.set(row.unitKey, places[index]));
  }

  const rows: StandingRow[] = round1.rows.map((row) => {
    const qualified = qualifierByKey.has(row.unitKey);
    const round2Row = qualified ? round2ByKey.get(row.unitKey) : undefined;

    return {
      unitKey: row.unitKey,
      code: row.code,
      entryId: row.entryId,
      participantId: row.participantId,
      qualified,
      // One judge in round 1, so its points and its rank are the same figure (N1).
      // A consolidated board carries a real sum and keeps it.
      round1Points: row.points ?? row.rank,
      round1Rank: row.rank,
      round2Points: round2Ready ? (round2Row?.points ?? null) : null,
      round2Rank: round2Ready ? (round2Row?.rank ?? null) : null,
      finalPoints: finalPointsByKey.get(row.unitKey) ?? null,
      finalRank: finalRankByKey.get(row.unitKey) ?? null,
    };
  });

  return rows.sort(
    (a, b) =>
      // Qualifiers first, before any rank is consulted — a contestant who did not
      // reach round 2 is never shown above one who did. Then by final rank, and
      // within a shared place by code, so a tie reads in a stable order without
      // that order implying a placement.
      Number(b.qualified) - Number(a.qualified) ||
      (a.finalRank ?? Number.POSITIVE_INFINITY) - (b.finalRank ?? Number.POSITIVE_INFINITY) ||
      (a.round1Rank ?? Number.POSITIVE_INFINITY) - (b.round1Rank ?? Number.POSITIVE_INFINITY) ||
      a.code.localeCompare(b.code)
  );
}

/**
 * The rows that placed, in order, for a results announcement.
 *
 * `places` counts *distinct* ranks, not rows, so a shared third place returns
 * both contestants when asked for the top three and the caller does not have to
 * decide which of two level performances to omit.
 */
export function topPlaces(rows: StandingRow[], places = 3): StandingRow[] {
  return rows.filter((row) => row.finalRank !== null && row.finalRank <= places);
}

/**
 * Whether a set of standings is safe to publish.
 *
 * Round 1 must have produced a field — an unsubmitted or empty round 1 draws no
 * qualifiers, and an incomplete consolidated board reports `rank: null` on every
 * row and so draws none either — and round 2 must be complete, because it is half
 * the deciding sum (N4, non-negotiable 4).
 *
 * A page asks this rather than re-deriving it, so "Lock results" and the results
 * table cannot disagree. It is not the authorisation boundary: `admin_lock_results`
 * re-checks three seated judges and three submitted sheets server-side (N1, N5).
 */
export function standingsPublishable(input: StandingsInput): boolean {
  return round1Qualifiers(input.round1, input.cut).length > 0 && input.round2.complete;
}
