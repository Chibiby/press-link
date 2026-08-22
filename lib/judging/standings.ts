import { competitionRank } from "./consolidate";
import { selectQualifiers } from "./qualifiers";
import type { ConsolidatedBoard, QualifierRow, StandingRow } from "./types";

/**
 * The label every screen must attach to a total-rank column.
 *
 * Non-negotiable 6. `totalRank` is round 1 plus round 2 and it decides nothing —
 * see {@link finalStandings}. It exists because tabulators are used to seeing it
 * and will compute it by hand if the sheet omits it, which is worse than printing
 * it with this note beside it. One constant so no page can quietly drop the
 * caveat.
 */
export const TOTAL_RANK_NOTE = "Informational only — the final rank is decided by round 2.";

/**
 * Competition placement over a composite key, for rows already in order.
 *
 * `competitionRank` compares single numbers; D4's qualifier ordering is a pair
 * (round-2 points, then round-1 points). Rather than invent a combined score —
 * which would need to know the range of both and would silently break when a
 * panel grew — this walks rows that are already sorted and only shares a place
 * when `tied` says the two rows are indistinguishable on *every* term of the key.
 *
 * The gap behaviour matches `competitionRank`: two rows sharing place 1 are
 * followed by place 3.
 */
function placeInOrder<T>(sorted: T[], tied: (previous: T, current: T) => boolean): number[] {
  const places: number[] = [];
  sorted.forEach((row, index) => {
    if (index > 0 && tied(sorted[index - 1], row)) places.push(places[index - 1]);
    else places.push(index + 1);
  });
  return places;
}

export interface StandingsInput {
  /** Round 1's consolidated board — the field, and who qualified. */
  round1: ConsolidatedBoard;
  /** Round 2's consolidated board, over the qualifiers only. */
  round2: ConsolidatedBoard;
  /** `events.round2_cut`. */
  cut: number;
}

/**
 * The event's standings (D4).
 *
 * ## Round 2 alone decides the winners
 *
 * A qualifier's final rank is its placement by **round-2 points ascending**. Round
 * 1 selected the field and then stopped counting. It re-enters in exactly one
 * place: as the tie-break when two qualifiers finish level on round-2 points, and
 * there the better round-1 points wins. Level on both is a genuine shared place,
 * not a coin toss.
 *
 * `totalRank` — round 1 plus round 2 — is **informational**. It is never sorted
 * by, never used to break a tie, and never called official (non-negotiable 6, and
 * see {@link TOTAL_RANK_NOTE}). It is easy to assume otherwise, because a rank sum
 * is exactly how a single round is scored; the difference is that within a round
 * the terms are one panel's opinions of one performance, while across rounds they
 * are opinions of two different performances over two different fields. Round 2's
 * field is a tenth the size, so a rank there is worth far more than the same rank
 * in round 1, and adding them treats them as equal.
 *
 * ## Non-qualifiers
 *
 * They sit below every qualifier — a contestant who did not reach round 2 cannot
 * finish above one who did, whatever their round-1 points were — as a block
 * starting at `qualifierCount + 1`, ordered among themselves by round-1 points.
 * That needs nothing from round 2, so their final rank is settled the moment round
 * 1 closes and does not move afterwards.
 *
 * The offset cannot collide with a qualifier's rank: competition ranking over
 * `n` qualifiers never yields a place above `n`.
 *
 * ## Incomplete rounds
 *
 * Round 1 incomplete: nothing is ranked at all, and every field is null. Round 2
 * incomplete: the qualifiers' round-2 and final ranks are null while the
 * non-qualifiers' final ranks are already known, because those never depended on
 * round 2.
 */
export function finalStandings({ round1, round2, cut }: StandingsInput): StandingRow[] {
  const qualifiers = selectQualifiers(round1, cut);
  const qualifierByKey = new Map<string, QualifierRow>(qualifiers.map((q) => [q.unitKey, q]));

  const round2ByKey = new Map(round2.rows.map((row) => [row.unitKey, row]));
  const round2Ready = round2.complete;

  // --- Qualifiers: placed by round 2, tie-broken by round 1. -----------------
  const finalRankByKey = new Map<string, number>();

  if (round2Ready) {
    const placed = qualifiers
      .map((q) => ({
        unitKey: q.unitKey,
        code: q.code,
        round1Points: q.round1Points,
        round2Points: round2ByKey.get(q.unitKey)?.points ?? null,
      }))
      // A qualifier with no round-2 points on a board that reports itself
      // complete would be a bug upstream, not a contestant to place last. Drop it
      // so it falls through to a null final rank and shows as unranked.
      .filter((row): row is typeof row & { round2Points: number } => row.round2Points !== null)
      .sort(
        (a, b) =>
          a.round2Points - b.round2Points ||
          a.round1Points - b.round1Points ||
          a.code.localeCompare(b.code)
      );

    const places = placeInOrder(
      placed,
      (previous, current) =>
        previous.round2Points === current.round2Points &&
        // Both terms of the key, or a tie-break that did separate two rows would
        // be thrown away again here and they would share a place after all.
        previous.round1Points === current.round1Points
    );
    placed.forEach((row, index) => finalRankByKey.set(row.unitKey, places[index]));
  }

  // --- Non-qualifiers: a block below everyone, ordered by round 1. -----------
  const nonQualifiers = round1.rows.filter((row) => !qualifierByKey.has(row.unitKey));

  if (round1.complete) {
    const ordered = [...nonQualifiers].sort(
      (a, b) => (a.points as number) - (b.points as number) || a.code.localeCompare(b.code)
    );
    const places = competitionRank(ordered.map((row) => row.points as number));
    ordered.forEach((row, index) =>
      finalRankByKey.set(row.unitKey, qualifiers.length + places[index])
    );
  }

  const rows: StandingRow[] = round1.rows.map((row) => {
    const qualified = qualifierByKey.has(row.unitKey);
    const round2Row = qualified ? round2ByKey.get(row.unitKey) : undefined;

    const round1Rank = row.rank;
    const round2Rank = round2Ready ? (round2Row?.rank ?? null) : null;
    const round2Points = round2Ready ? (round2Row?.points ?? null) : null;

    return {
      unitKey: row.unitKey,
      code: row.code,
      entryId: row.entryId,
      participantId: row.participantId,
      qualified,
      round1Points: row.points,
      round1Rank,
      round2Points,
      round2Rank,
      // Printed, never consulted. Null unless both rounds actually produced a
      // rank, so a half-known sum never appears as a smaller number beside a
      // complete one.
      totalRank: round1Rank !== null && round2Rank !== null ? round1Rank + round2Rank : null,
      finalRank: finalRankByKey.get(row.unitKey) ?? null,
    };
  });

  return rows.sort(
    (a, b) =>
      // Qualifiers first, before any rank is consulted. Once both rounds are in
      // this changes nothing — a qualifier's final rank is always below the
      // qualifier count and a non-qualifier's is always above it — but it is what
      // keeps the table sane *during* round 2. A non-qualifier's final rank is
      // settled the moment round 1 closes while a qualifier's is still null, and
      // ranking nulls last would float the eliminated contestants to the top of
      // the sheet while the title is still being decided.
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
 * Both rounds have to be complete: round 1 because the field and the cut depend
 * on it, round 2 because it decides the winners. A page asks this rather than
 * re-deriving it, so "Lock results" and the results table cannot disagree.
 */
export function standingsPublishable(input: StandingsInput): boolean {
  return input.round1.complete && input.round2.complete;
}
