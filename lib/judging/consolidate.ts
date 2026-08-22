import type {
  BoardRow,
  ConsolidatedBoard,
  ContestUnit,
  JudgeRank,
  JudgingRound,
  MissingRank,
} from "./types";

/**
 * Competition placement of each value, ascending: 1, 2, 2, 4.
 *
 * Returns places positionally — `competitionRank([3, 5, 5, 7])` is
 * `[1, 2, 2, 4]` — so a caller can zip the result back onto the rows it came
 * from without sorting anything itself.
 *
 * Competition ranking, with the gap after a tie, and not dense ranking
 * (1, 2, 2, 3). The gap is not cosmetic: **D3 depends on it.** Round 2's cut is
 * `round1Rank <= cut`, so a three-way tie for 10th under a cut of 10 produces
 * three rows at rank 10 and all three advance. Under dense ranking those rows
 * would sit at 10 while a fourth contestant also held 11, and the size of the
 * qualifying field would stop being readable from the ranks at all.
 *
 * Equal values share a place by construction — the first index at which a value
 * appears in sorted order *is* its place — so no tie-break is applied here. A
 * caller that needs one (D4 breaks a round-2 tie by round-1 points) must rank a
 * composite key, not post-process this output.
 */
export function competitionRank(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);

  const placeOf = new Map<number, number>();
  sorted.forEach((value, index) => {
    // First occurrence wins: index 1 and 2 both holding 5 means 5's place is 2,
    // and index 3 is therefore place 4. That single line is the tie behaviour.
    if (!placeOf.has(value)) placeOf.set(value, index + 1);
  });

  return values.map((value) => placeOf.get(value) as number);
}

export interface ConsolidateInput {
  round: JudgingRound;
  /** The round's unit set. Round 1 is everyone; round 2 is the qualifiers. */
  units: ContestUnit[];
  /** Every rank on file for this round, from every judge. Stale rows are tolerated. */
  ranks: JudgeRank[];
  /** The panel, in seat order. */
  judgeIds: string[];
}

/**
 * One round's standings across the whole panel.
 *
 * D1: a unit's **points** are the sum of the ranks the judges gave it, and the
 * round's **rank** is the placement of those points ascending. One judge is the
 * degenerate case — a sum of one term — so nothing here special-cases panel
 * size, and a two-judge panel needs no separate code path from a five-judge one.
 *
 * ## `complete` is a gate, not a statistic
 *
 * It answers "may this board be ranked?", and three different situations answer
 * no:
 *
 * - a judge has not ranked every unit — the obvious one;
 * - **no judge is assigned** — vacuously "every judge has finished", which is
 *   why it is excluded by hand. A board ranked over an empty panel would give
 *   every unit 0 points and therefore joint first place, and `admin_close_round1`
 *   would happily publish it;
 * - **no unit exists** — likewise vacuous. An event with no entries has nothing
 *   to rank, and letting it read complete would let an admin close round 1 on an
 *   empty event and freeze an empty result as official.
 *
 * When it is false, **every row reports `points: null` and `rank: null`**
 * (non-negotiable 4). Not the rows that happen to be finished — all of them. A
 * partial sum is a smaller number than a complete one, so ranking a partial
 * panel does not merely omit information, it actively favours whichever unit the
 * absent judge had not reached.
 *
 * `ranksByJudge` is still populated in that state, because a progress screen has
 * to show who has done what. Showing a judge's own ranks is safe; adding them up
 * across an incomplete panel is not.
 */
export function consolidateRound({
  round,
  units,
  ranks,
  judgeIds,
}: ConsolidateInput): ConsolidatedBoard {
  const panel = new Set(judgeIds);

  const ranksByUnit = new Map<string, Record<string, number>>(
    units.map((unit) => [unit.unitKey, {}])
  );

  for (const rank of ranks) {
    // A rank from a judge who is no longer on the panel, or for a unit not in
    // this round, is stale: a judge was unassigned, an entry was deleted, or a
    // round-1 rank arrived alongside round 2's. Counting it would add points to
    // a unit no living judge ranked and silently move a placement, so it is
    // dropped rather than trusted. The row stays in the database; only this
    // board ignores it.
    if (!panel.has(rank.judgeId)) continue;
    const byJudge = ranksByUnit.get(rank.unitKey);
    if (!byJudge) continue;
    byJudge[rank.judgeId] = rank.rank;
  }

  const missing: MissingRank[] = [];
  for (const unit of units) {
    const byJudge = ranksByUnit.get(unit.unitKey) ?? {};
    for (const judgeId of judgeIds) {
      if (byJudge[judgeId] === undefined) {
        missing.push({ judgeId, unitKey: unit.unitKey, code: unit.code });
      }
    }
  }

  const complete = judgeIds.length > 0 && units.length > 0 && missing.length === 0;

  const pointsByUnit = new Map<string, number>();
  if (complete) {
    for (const unit of units) {
      const byJudge = ranksByUnit.get(unit.unitKey) ?? {};
      pointsByUnit.set(
        unit.unitKey,
        judgeIds.reduce((sum, judgeId) => sum + (byJudge[judgeId] ?? 0), 0)
      );
    }
  }

  const ordered = [...units];
  const rankByUnit = new Map<string, number>();

  if (complete) {
    const keys = ordered.map((unit) => unit.unitKey);
    const places = competitionRank(keys.map((key) => pointsByUnit.get(key) as number));
    keys.forEach((key, index) => rankByUnit.set(key, places[index]));
    // Rank first, then code inside a tie. Two units that genuinely share a place
    // must still come back in a fixed order, or the sheet reshuffles between two
    // reads of the same data and a tabulator cannot tell a redraw from a change.
    ordered.sort(
      (a, b) =>
        (rankByUnit.get(a.unitKey) as number) - (rankByUnit.get(b.unitKey) as number) ||
        a.code.localeCompare(b.code)
    );
  } else {
    ordered.sort((a, b) => a.code.localeCompare(b.code));
  }

  const rows: BoardRow[] = ordered.map((unit) => ({
    unitKey: unit.unitKey,
    code: unit.code,
    entryId: unit.entryId,
    participantId: unit.participantId,
    points: complete ? (pointsByUnit.get(unit.unitKey) as number) : null,
    rank: complete ? (rankByUnit.get(unit.unitKey) as number) : null,
    ranksByJudge: ranksByUnit.get(unit.unitKey) ?? {},
  }));

  return {
    round,
    rows,
    judgeIds: [...judgeIds],
    complete,
    // Nothing is outstanding on a complete board, and an empty panel or an empty
    // unit set has no outstanding *pair* to name either — `missing` is empty in
    // both, which is exactly why `complete` cannot be derived from it alone.
    missing,
  };
}

/**
 * How far through a round the panel is, as a fraction a page can print.
 *
 * Derived here rather than in a component so the judges' progress column and the
 * admin panel's cannot disagree about what "3 of 5 done" counts.
 */
export function boardProgress(board: ConsolidatedBoard): {
  filled: number;
  expected: number;
  judgesDone: number;
} {
  const expected = board.rows.length * board.judgeIds.length;
  const filled = board.rows.reduce(
    (sum, row) => sum + Object.keys(row.ranksByJudge).length,
    0
  );
  const judgesDone =
    board.rows.length === 0
      ? // Vacuously every judge has ranked every one of no units. Reporting
        // "1 of 1 judges finished" beside a board that cannot be ranked is a
        // contradiction on screen, so an empty event has nobody finished.
        0
      : board.judgeIds.filter((judgeId) =>
          board.rows.every((row) => row.ranksByJudge[judgeId] !== undefined)
        ).length;

  return { filled, expected, judgesDone };
}
