import { describe, expect, it } from "vitest";

import { boardProgress, competitionRank, consolidateRound } from "./consolidate";
import type { ContestUnit, JudgeRank } from "./types";

function unit(code: string, key = `u-${code}`): ContestUnit {
  return { unitKey: key, code, entryId: `e-${code}`, participantId: key };
}

const A = unit("0001", "a");
const B = unit("0002", "b");
const C = unit("0003", "c");
const D = unit("0004", "d");

/** Ranks as a judge would file them: one row per unit. */
function sheet(judgeId: string, places: Record<string, number>): JudgeRank[] {
  return Object.entries(places).map(([unitKey, rank]) => ({ judgeId, unitKey, rank }));
}

describe("competitionRank", () => {
  it("leaves a gap after a tie", () => {
    expect(competitionRank([3, 5, 5, 7])).toEqual([1, 2, 2, 4]);
  });

  it("returns places positionally, not sorted", () => {
    // The caller zips this back onto its own rows, so the third place must come
    // back in the third slot even though 2 is the smallest value.
    expect(competitionRank([9, 5, 2])).toEqual([3, 2, 1]);
  });

  it("gives every unit first place when all are level", () => {
    expect(competitionRank([4, 4, 4])).toEqual([1, 1, 1]);
  });

  it("handles one value and none", () => {
    expect(competitionRank([7])).toEqual([1]);
    expect(competitionRank([])).toEqual([]);
  });

  it("puts three units on rank 10, which is how 12 qualify under a cut of 10", () => {
    // D3 depends on this exact shape. Nine clear places, then a three-way tie.
    // All three read rank 10, all three pass `<= 10`, and the field is 12 — not
    // a special case anywhere, just what the gap does.
    const points = [1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 20, 20];
    const places = competitionRank(points);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10]);
    expect(places.filter((p) => p <= 10)).toHaveLength(12);
  });

  it("never returns 0", () => {
    // Places are 1-based. A 0 would read as "unranked" downstream.
    expect(competitionRank([0, 0, -3]).every((p) => p >= 1)).toBe(true);
  });
});

describe("consolidateRound — one judge", () => {
  const board = consolidateRound({
    round: 1,
    units: [A, B, C],
    judgeIds: ["j1"],
    ranks: sheet("j1", { a: 2, b: 1, c: 3 }),
  });

  it("is complete", () => {
    expect(board.complete).toBe(true);
    expect(board.missing).toEqual([]);
  });

  it("takes the judge's ranks as the points, unchanged", () => {
    // A one-judge panel is a sum of one term, not a separate code path.
    expect(board.rows.map((r) => [r.code, r.points])).toEqual([
      ["0002", 1],
      ["0001", 2],
      ["0003", 3],
    ]);
  });

  it("ranks in the judge's order", () => {
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe("consolidateRound — a panel sums ranks (D1)", () => {
  // Five judges, four units, built so the winner is not the unit with the most
  // first places. A takes two firsts and still loses to B, which took none.
  const board = consolidateRound({
    round: 1,
    units: [A, B, C, D],
    judgeIds: ["j1", "j2", "j3", "j4", "j5"],
    ranks: [
      ...sheet("j1", { a: 1, b: 2, c: 3, d: 4 }),
      ...sheet("j2", { a: 1, b: 2, c: 3, d: 4 }),
      ...sheet("j3", { a: 4, b: 2, c: 1, d: 3 }),
      ...sheet("j4", { a: 4, b: 2, c: 1, d: 3 }),
      ...sheet("j5", { a: 4, b: 2, c: 1, d: 3 }),
    ],
  });

  it("adds each judge's rank into the unit's points", () => {
    const points = Object.fromEntries(board.rows.map((r) => [r.unitKey, r.points]));
    expect(points).toEqual({ a: 14, b: 10, c: 9, d: 17 });
  });

  it("places the lowest points first", () => {
    expect(board.rows.map((r) => r.unitKey)).toEqual(["c", "b", "a", "d"]);
  });

  it("puts a unit with no first places ahead of one with two", () => {
    // The point of a rank sum: consistency beats a spike. B was second on every
    // sheet and finishes above A, which was first twice and last three times.
    const rankOf = Object.fromEntries(board.rows.map((r) => [r.unitKey, r.rank]));
    expect(rankOf.b).toBe(2);
    expect(rankOf.a).toBe(3);
  });

  it("keeps every judge's own rank visible on the row", () => {
    const a = board.rows.find((r) => r.unitKey === "a");
    expect(a?.ranksByJudge).toEqual({ j1: 1, j2: 1, j3: 4, j4: 4, j5: 4 });
  });

  it("reports the panel it used", () => {
    expect(board.judgeIds).toEqual(["j1", "j2", "j3", "j4", "j5"]);
  });
});

describe("consolidateRound — ties", () => {
  const board = consolidateRound({
    round: 1,
    units: [A, B, C],
    judgeIds: ["j1", "j2"],
    ranks: [...sheet("j1", { a: 1, b: 2, c: 3 }), ...sheet("j2", { a: 2, b: 1, c: 3 })],
  });

  it("gives equal points the same rank, then skips", () => {
    expect(board.rows.map((r) => [r.points, r.rank])).toEqual([
      [3, 1],
      [3, 1],
      [6, 3],
    ]);
  });

  it("orders tied units by code so the sheet does not reshuffle between reads", () => {
    expect(board.rows.map((r) => r.code)).toEqual(["0001", "0002", "0003"]);
  });
});

describe("consolidateRound — an incomplete panel produces no ranking", () => {
  const board = consolidateRound({
    round: 1,
    units: [A, B, C],
    judgeIds: ["j1", "j2"],
    // j1 has finished. j2 has ranked one unit.
    ranks: [...sheet("j1", { a: 1, b: 2, c: 3 }), ...sheet("j2", { a: 1 })],
  });

  it("is not complete", () => {
    expect(board.complete).toBe(false);
  });

  it("nulls the points and rank of EVERY row, including the finished ones", () => {
    // Non-negotiable 4. Unit A has both judges' ranks, but publishing its sum
    // beside two half-sums would rank it against smaller numbers and hand it a
    // place it has not earned. The whole board waits.
    expect(board.rows.every((r) => r.points === null)).toBe(true);
    expect(board.rows.every((r) => r.rank === null)).toBe(true);
  });

  it("still shows who has filed what, so a progress screen works", () => {
    const byKey = Object.fromEntries(board.rows.map((r) => [r.unitKey, r.ranksByJudge]));
    expect(byKey.a).toEqual({ j1: 1, j2: 1 });
    expect(byKey.b).toEqual({ j1: 2 });
  });

  it("names every outstanding judge-and-unit pair", () => {
    expect(board.missing).toEqual([
      { judgeId: "j2", unitKey: "b", code: "0002" },
      { judgeId: "j2", unitKey: "c", code: "0003" },
    ]);
  });

  it("falls back to code order", () => {
    expect(board.rows.map((r) => r.code)).toEqual(["0001", "0002", "0003"]);
  });
});

describe("consolidateRound — the vacuous cases", () => {
  it("does not call an unjudged event complete", () => {
    // "Every judge has ranked every unit" is trivially true of no judges. A board
    // ranked here would give every unit 0 points and therefore joint first, and
    // admin_close_round1 would publish it.
    const board = consolidateRound({ round: 1, units: [A, B], judgeIds: [], ranks: [] });
    expect(board.complete).toBe(false);
    expect(board.missing).toEqual([]);
    expect(board.rows.every((r) => r.rank === null)).toBe(true);
  });

  it("does not call an empty event complete", () => {
    // Likewise vacuous, and it would let an admin freeze an empty result as
    // official for an event whose entries never arrived.
    const board = consolidateRound({ round: 1, units: [], judgeIds: ["j1"], ranks: [] });
    expect(board.complete).toBe(false);
    expect(board.rows).toEqual([]);
  });

  it("does not call nothing at all complete", () => {
    const board = consolidateRound({ round: 1, units: [], judgeIds: [], ranks: [] });
    expect(board.complete).toBe(false);
  });
});

describe("consolidateRound — stale ranks", () => {
  it("ignores a rank from a judge who is no longer on the panel", () => {
    // An unassigned judge's sheet stays in the table. Counting it would add
    // points no living judge awarded and move a placement invisibly.
    const board = consolidateRound({
      round: 1,
      units: [A, B],
      judgeIds: ["j1"],
      ranks: [...sheet("j1", { a: 1, b: 2 }), ...sheet("dropped", { a: 9, b: 9 })],
    });
    expect(board.complete).toBe(true);
    expect(board.rows.map((r) => r.points)).toEqual([1, 2]);
    expect(board.rows[0].ranksByJudge).toEqual({ j1: 1 });
  });

  it("ignores a rank for a unit not in this round", () => {
    // Exactly what round 2 sees: round 1's ranks are on file for units that did
    // not qualify, and they must not leak into round 2's board.
    const board = consolidateRound({
      round: 2,
      units: [A],
      judgeIds: ["j1"],
      ranks: sheet("j1", { a: 1, b: 2, c: 3 }),
    });
    expect(board.complete).toBe(true);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].points).toBe(1);
  });

  it("does not let a stale rank stand in for a missing one", () => {
    const board = consolidateRound({
      round: 1,
      units: [A],
      judgeIds: ["j1"],
      ranks: sheet("dropped", { a: 1 }),
    });
    expect(board.complete).toBe(false);
    expect(board.missing).toEqual([{ judgeId: "j1", unitKey: "a", code: "0001" }]);
  });
});

describe("consolidateRound — round", () => {
  it("reports the round it was asked for", () => {
    expect(consolidateRound({ round: 2, units: [], judgeIds: [], ranks: [] }).round).toBe(2);
  });
});

describe("boardProgress", () => {
  const board = consolidateRound({
    round: 1,
    units: [A, B, C],
    judgeIds: ["j1", "j2"],
    ranks: [...sheet("j1", { a: 1, b: 2, c: 3 }), ...sheet("j2", { a: 1 })],
  });

  it("counts filled against expected across the whole panel", () => {
    expect(boardProgress(board)).toMatchObject({ filled: 4, expected: 6 });
  });

  it("counts only the judges who have ranked every unit as done", () => {
    expect(boardProgress(board).judgesDone).toBe(1);
  });

  it("reports a complete board as fully filled", () => {
    const done = consolidateRound({
      round: 1,
      units: [A, B],
      judgeIds: ["j1"],
      ranks: sheet("j1", { a: 1, b: 2 }),
    });
    expect(boardProgress(done)).toEqual({ filled: 2, expected: 2, judgesDone: 1 });
  });

  it("reports nobody finished on an empty event", () => {
    // Not 1 of 1. "Every judge has ranked every unit" is vacuously true of no
    // units, and printing that beside a board that cannot be ranked reads as a
    // contradiction.
    const empty = consolidateRound({ round: 1, units: [], judgeIds: ["j1"], ranks: [] });
    expect(boardProgress(empty)).toEqual({ filled: 0, expected: 0, judgesDone: 0 });
  });
});
