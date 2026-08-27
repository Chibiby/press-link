import { describe, expect, it } from "vitest";

import { competitionRank, consolidateRound } from "./consolidate";
import { round1Board } from "./cut";
import { finalStandings, standingsPublishable, topPlaces } from "./standings";
import type { BoardRow, ConsolidatedBoard, ContestUnit, JudgeRank, JudgingRound } from "./types";

/**
 * The official placement, per N4: `round1Rank + round2Points`.
 *
 * These tests replace the D4 suite, under which round 2 alone decided and the sum
 * was a column tabulators were warned not to read. Several of them assert the
 * opposite of what the same case asserted before — most visibly that a
 * non-qualifier now has **no** final rank rather than a place in a block beneath
 * the qualifiers.
 *
 * Round 2's points are stated directly in these fixtures, and they are kept
 * internally consistent: three judges ranking n qualifiers produce points summing
 * to `3 * n * (n + 1) / 2`. A fixture that broke that would describe a panel that
 * cannot exist, and a reader could not check the arithmetic against it.
 */

/**
 * Round 1 as one judge's sheet (N1): `[code, rank]`, with null for a blank.
 *
 * Built through the real `round1Board`, so the fixture cannot disagree with
 * production about ties, blanks or ordering.
 */
function round1Of(entries: [code: string, rank: number | null][]) {
  const units: ContestUnit[] = entries.map(([code]) => ({
    unitKey: `u-${code}`,
    code,
    entryId: `e-${code}`,
    participantId: `p-${code}`,
  }));
  const ranks: JudgeRank[] = entries
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .map(([code, rank]) => ({ judgeId: "seat-1", unitKey: `u-${code}`, rank }));
  return round1Board(units, ranks);
}

/** A consolidated panel board stated as points, with ranks from the real rank function. */
function panelBoard(
  round: JudgingRound,
  entries: [code: string, points: number][],
  complete = true
): ConsolidatedBoard {
  const places = competitionRank(entries.map(([, points]) => points));
  const rows: BoardRow[] = entries.map(([code, points], index) => ({
    unitKey: `u-${code}`,
    code,
    entryId: `e-${code}`,
    participantId: `p-${code}`,
    points: complete ? points : null,
    rank: complete ? places[index] : null,
    ranksByJudge: {},
  }));
  rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.code.localeCompare(b.code));
  return { round, rows, judgeIds: ["j2", "j3", "j4"], complete, missing: [] };
}

const byCode = (rows: { code: string }[]) => rows.map((r) => r.code);
const rankByCode = (rows: { code: string; finalRank: number | null }[]) =>
  Object.fromEntries(rows.map((r) => [r.code, r.finalRank]));

describe("finalStandings — the sum of both rounds decides (N4)", () => {
  // Six contestants, cut of three. Round 2 reverses round 1 exactly: the three
  // judges all placed round 1's third first.
  const rows = finalStandings({
    round1: round1Of([
      ["0001", 1],
      ["0002", 2],
      ["0003", 3],
      ["0004", null],
      ["0005", null],
      ["0006", null],
    ]),
    round2: panelBoard(2, [
      ["0001", 9],
      ["0002", 6],
      ["0003", 3],
    ]),
    cut: 3,
  });
  const rankOf = rankByCode(rows);

  it("adds round 1's rank to round 2's points", () => {
    expect(rows.find((r) => r.code === "0003")).toMatchObject({
      round1Rank: 3,
      round2Points: 3,
      finalPoints: 6,
    });
  });

  it("reports the sum for every qualifier", () => {
    expect(rows.filter((r) => r.qualified).map((r) => r.finalPoints)).toEqual([6, 8, 10]);
  });

  it("places by the sum, ascending", () => {
    expect(rankOf["0003"]).toBe(1);
    expect(rankOf["0002"]).toBe(2);
    expect(rankOf["0001"]).toBe(3);
  });

  it("returns the qualifiers in final order", () => {
    expect(byCode(rows.slice(0, 3))).toEqual(["0003", "0002", "0001"]);
  });

  it("marks who qualified", () => {
    expect(rows.filter((r) => r.qualified).map((r) => r.code)).toEqual(["0003", "0002", "0001"]);
  });

  it("carries both rounds' points and ranks", () => {
    expect(rows[0]).toMatchObject({
      code: "0003",
      // One judge in round 1, so its points and its rank are the same figure (N1).
      round1Points: 3,
      round1Rank: 3,
      round2Points: 3,
      round2Rank: 1,
    });
  });
});

describe("finalStandings — round 1 is part of the sum, not merely a selector", () => {
  // The clearest case for N4 over D4. Round 2's winner does not win: it was
  // fourth after the cut, and three places of deficit outweigh one place of
  // advantage in round 2.
  const rows = finalStandings({
    round1: round1Of([
      ["0001", 1],
      ["0002", 2],
      ["0003", 3],
      ["0004", 4],
    ]),
    round2: panelBoard(2, [
      ["0001", 5],
      ["0002", 9],
      ["0003", 12],
      ["0004", 4],
    ]),
    cut: 4,
  });
  const rankOf = rankByCode(rows);

  it("does not crown round 2's winner", () => {
    // Under D4 this contestant took the title on round 2 alone.
    expect(rows.find((r) => r.code === "0004")?.round2Rank).toBe(1);
    expect(rankOf["0004"]).toBe(2);
  });

  it("crowns the contestant with the lowest sum", () => {
    expect(rankOf["0001"]).toBe(1);
    expect(rows.find((r) => r.code === "0001")?.finalPoints).toBe(6);
  });

  it("separates two contestants round 2 left level", () => {
    // Round 2 gave these two equal points, so it has no opinion about their
    // order. Round 1 does, and under N4 that opinion is arithmetic rather than a
    // tie-break bolted on afterwards.
    const level = finalStandings({
      round1: round1Of([
        ["0001", 1],
        ["0002", 2],
        ["0003", 3],
      ]),
      round2: panelBoard(2, [
        ["0001", 7],
        ["0002", 7],
        ["0003", 4],
      ]),
      cut: 3,
    });
    const at = rankByCode(level);
    expect(at["0003"]).toBe(1);
    expect(at["0001"]).toBe(2);
    expect(at["0002"]).toBe(3);
  });
});

describe("finalStandings — a genuine tie is a shared place, with no tie-break", () => {
  // 0001 and 0002 both sum to 9, and the two rounds disagree about which is
  // better: round 1 has 0001 ahead, round 2 has 0002 ahead. Any tie-break at all
  // would therefore be visible here, which is the point of the fixture.
  const rows = finalStandings({
    round1: round1Of([
      ["0001", 1],
      ["0002", 2],
      ["0003", 3],
      ["0004", 4],
    ]),
    round2: panelBoard(2, [
      ["0001", 8],
      ["0002", 7],
      ["0003", 4],
      ["0004", 11],
    ]),
    cut: 4,
  });
  const rankOf = rankByCode(rows);

  it("gives both contestants the same final rank", () => {
    expect(rankOf["0001"]).toBe(2);
    expect(rankOf["0002"]).toBe(2);
  });

  it("does not break the tie on round 2", () => {
    // Round 2 placed 0002 above 0001. N4 withdrew round 2's authority to decide,
    // and it does not get it back as a tie-break.
    const round2Ranks = Object.fromEntries(rows.map((r) => [r.code, r.round2Rank]));
    expect(round2Ranks["0002"]).toBeLessThan(round2Ranks["0001"] as number);
    expect(rankOf["0002"]).toBe(rankOf["0001"]);
  });

  it("does not break the tie on round 1 either", () => {
    expect(rows.find((r) => r.code === "0001")?.round1Rank).toBe(1);
    expect(rows.find((r) => r.code === "0002")?.round1Rank).toBe(2);
    expect(rankOf["0001"]).toBe(rankOf["0002"]);
  });

  it("leaves the gap after the shared place", () => {
    expect(rankOf["0003"]).toBe(1);
    expect(rankOf["0004"]).toBe(4);
  });

  it("still orders the tied rows deterministically on screen", () => {
    // The rows have to come back in *some* order, and it is round 1 then code —
    // presentation only. The shared rank beside them is what says they are level.
    expect(byCode(rows.slice(1, 3))).toEqual(["0001", "0002"]);
  });
});

describe("finalStandings — non-qualifiers", () => {
  const rows = finalStandings({
    round1: round1Of([
      ["0001", 1],
      ["0002", 2],
      ["0003", null],
      ["0004", null],
      ["0005", null],
    ]),
    round2: panelBoard(2, [
      ["0001", 4],
      ["0002", 5],
    ]),
    cut: 2,
  });
  const eliminated = rows.filter((r) => !r.qualified);

  it("gives them no final placement at all", () => {
    // The reversal of D4, which placed them in a block starting one past the
    // qualifier count. A blank in round 1 is an elimination (N2), and an
    // eliminated contestant has no place in the event's standings — reporting
    // "11th of 12" for someone the judge struck out reads as a result they
    // achieved.
    for (const row of eliminated) {
      expect(row.finalRank).toBeNull();
      expect(row.finalPoints).toBeNull();
    }
  });

  it("gives them no round-1 figures either, because they were never scored", () => {
    for (const row of eliminated) {
      expect(row.round1Rank).toBeNull();
      expect(row.round1Points).toBeNull();
    }
  });

  it("gives them no round-2 figures", () => {
    for (const row of eliminated) {
      expect(row.round2Points).toBeNull();
      expect(row.round2Rank).toBeNull();
    }
  });

  it("lists them below every qualifier", () => {
    expect(byCode(rows)).toEqual(["0001", "0002", "0003", "0004", "0005"]);
  });

  it("orders them by code, since nothing separates them", () => {
    expect(byCode(eliminated)).toEqual(["0003", "0004", "0005"]);
  });

  it("still places the qualifiers", () => {
    expect(rankByCode(rows)["0001"]).toBe(1);
    expect(rankByCode(rows)["0002"]).toBe(2);
  });
});

describe("finalStandings — twelve qualify under a cut of ten (D3)", () => {
  const rows = finalStandings({
    round1: round1Of([
      ["0001", 1],
      ["0002", 2],
      ["0003", 3],
      ["0004", 4],
      ["0005", 5],
      ["0006", 6],
      ["0007", 7],
      ["0008", 8],
      ["0009", 9],
      ["0010", 10],
      ["0011", 10],
      ["0012", 10],
      ["0013", null],
    ]),
    // Every judge agrees, so each unit's points are three times its round-2 place.
    round2: panelBoard(
      2,
      Array.from(
        { length: 12 },
        (_, i) => [String(i + 1).padStart(4, "0"), (i + 1) * 3] as [string, number]
      )
    ),
    cut: 10,
  });

  it("qualifies twelve", () => {
    expect(rows.filter((r) => r.qualified)).toHaveLength(12);
  });

  it("places all twelve, one to twelve", () => {
    expect(rows.slice(0, 12).map((r) => r.finalRank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("separates the three who tied on the cut by their round 2", () => {
    // They came out of round 1 level, so their final order is round 2's alone —
    // which is exactly what the sum produces when one term is equal.
    const tied = rows.filter((r) => r.round1Rank === 10);
    expect(tied.map((r) => r.finalPoints)).toEqual([40, 43, 46]);
    expect(tied.map((r) => r.finalRank)).toEqual([10, 11, 12]);
  });

  it("does not place the contestant who missed the cut at 13", () => {
    // D4 put them at 13, one past the qualifier count. They are eliminated.
    expect(rows.find((r) => r.code === "0013")?.finalRank).toBeNull();
  });
});

describe("finalStandings — an incomplete round 2 (non-negotiable 4)", () => {
  const round1 = round1Of([
    ["0001", 1],
    ["0002", 2],
    ["0003", null],
  ]);

  /** Round 2 with three judges, one of whom has not ranked `0002`. */
  const partialRound2 = consolidateRound({
    round: 2,
    units: [
      { unitKey: "u-0001", code: "0001", entryId: "e-0001", participantId: "p-0001" },
      { unitKey: "u-0002", code: "0002", entryId: "e-0002", participantId: "p-0002" },
    ],
    ranks: [
      { judgeId: "j2", unitKey: "u-0001", rank: 1 },
      { judgeId: "j2", unitKey: "u-0002", rank: 2 },
      { judgeId: "j3", unitKey: "u-0001", rank: 1 },
      { judgeId: "j3", unitKey: "u-0002", rank: 2 },
      { judgeId: "j4", unitKey: "u-0001", rank: 1 },
    ],
    judgeIds: ["j2", "j3", "j4"],
  });

  it("ranks nobody, not even where the outstanding judge could not change the order", () => {
    // Two judges have 0001 first and the third has ranked it first as well; no
    // remaining ballot could put 0002 above it. The ranking is still withheld,
    // because a partial sum is a smaller number and publishing it would favour
    // whichever contestant the absent judge had not reached.
    const rows = finalStandings({ round1, round2: partialRound2, cut: 2 });
    for (const row of rows) {
      expect(row.finalRank).toBeNull();
      expect(row.finalPoints).toBeNull();
    }
  });

  it("withholds round 2's own figures too", () => {
    const rows = finalStandings({ round1, round2: partialRound2, cut: 2 });
    for (const row of rows) {
      expect(row.round2Points).toBeNull();
      expect(row.round2Rank).toBeNull();
    }
  });

  it("still reports round 1 and who qualified", () => {
    const rows = finalStandings({ round1, round2: partialRound2, cut: 2 });
    expect(rows.find((r) => r.code === "0001")).toMatchObject({ qualified: true, round1Rank: 1 });
    expect(rows.find((r) => r.code === "0003")).toMatchObject({
      qualified: false,
      round1Rank: null,
    });
  });

  it("keeps the qualifiers at the top of the sheet while round 2 is open", () => {
    // Every rank is null mid-round-2, so the qualified-first term of the sort is
    // the only thing holding the contenders above the eliminated.
    const rows = finalStandings({ round1, round2: partialRound2, cut: 2 });
    expect(byCode(rows)).toEqual(["0001", "0002", "0003"]);
  });

  it("ranks nothing while round 1 is unsubmitted", () => {
    const rows = finalStandings({
      round1: round1Of([
        ["0001", null],
        ["0002", null],
      ]),
      round2: panelBoard(2, [], false),
      cut: 2,
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.qualified).toBe(false);
      expect(row.finalRank).toBeNull();
    }
  });

  it("handles an event with no contestants", () => {
    expect(finalStandings({ round1: round1Of([]), round2: panelBoard(2, []), cut: 10 })).toEqual([]);
  });
});

describe("finalStandings — a qualifier missing from a complete round 2", () => {
  // The N8 hazard: an admin unlocked round 1, the judge added a rank, and the
  // round-2 board was built over the old, smaller unit set. It reports itself
  // complete because every seated judge ranked every unit *it* knows about.
  const rows = finalStandings({
    round1: round1Of([
      ["0001", 1],
      ["0002", 2],
      ["0003", 3],
    ]),
    round2: panelBoard(2, [
      ["0001", 4],
      ["0002", 5],
    ]),
    cut: 3,
  });

  it("leaves the unscored qualifier unranked rather than placing it last", () => {
    expect(rows.find((r) => r.code === "0003")).toMatchObject({
      qualified: true,
      round1Rank: 3,
      round2Points: null,
      finalPoints: null,
      finalRank: null,
    });
  });

  it("does not let its absence shift the others' places", () => {
    expect(rankByCode(rows)["0001"]).toBe(1);
    expect(rankByCode(rows)["0002"]).toBe(2);
  });
});

describe("finalStandings — round 1 as a consolidated panel board", () => {
  // The pre-N1 shape, still fed here by the admin event index for a group event
  // (non-negotiable 6). Points and rank are different numbers on such a board.
  const rows = finalStandings({
    round1: panelBoard(1, [
      ["0001", 4],
      ["0002", 4],
      ["0003", 9],
      ["0004", 14],
    ]),
    round2: panelBoard(2, [
      ["0001", 4],
      ["0002", 5],
    ]),
    cut: 2,
  });

  it("keeps the panel's summed round-1 points rather than the rank", () => {
    expect(rows.find((r) => r.code === "0001")).toMatchObject({ round1Points: 4, round1Rank: 1 });
  });

  it("adds the round-1 rank, not the round-1 points, to round 2", () => {
    // 0001 sums to 1 + 4. Adding its four points instead would let a large panel
    // swamp round 2 entirely.
    expect(rows.find((r) => r.code === "0001")?.finalPoints).toBe(5);
  });

  it("reports a non-qualifier's real round-1 rank but gives it no placement", () => {
    expect(rows.find((r) => r.code === "0003")).toMatchObject({
      qualified: false,
      round1Rank: 3,
      round1Points: 9,
      finalRank: null,
    });
  });
});

describe("topPlaces", () => {
  const rows = finalStandings({
    round1: round1Of([
      ["0001", 1],
      ["0002", 2],
      ["0003", 3],
      ["0004", 4],
    ]),
    round2: panelBoard(2, [
      ["0001", 3],
      ["0002", 6],
      ["0003", 9],
      ["0004", 12],
    ]),
    cut: 4,
  });

  it("returns the top three by default", () => {
    expect(byCode(topPlaces(rows))).toEqual(["0001", "0002", "0003"]);
  });

  it("counts places, not rows, so a shared place returns both contestants", () => {
    const shared = finalStandings({
      round1: round1Of([
        ["0001", 1],
        ["0002", 2],
      ]),
      round2: panelBoard(2, [
        ["0001", 5],
        ["0002", 4],
      ]),
      cut: 2,
    });
    expect(shared.map((r) => r.finalPoints)).toEqual([6, 6]);
    expect(topPlaces(shared, 1)).toHaveLength(2);
  });

  it("omits a non-qualifier, which has no place to be in the top three", () => {
    const withEliminated = finalStandings({
      round1: round1Of([
        ["0001", 1],
        ["0002", null],
      ]),
      round2: panelBoard(2, [["0001", 3]]),
      cut: 1,
    });
    expect(byCode(topPlaces(withEliminated))).toEqual(["0001"]);
  });

  it("returns nothing while round 2 is open", () => {
    const open = finalStandings({
      round1: round1Of([["0001", 1]]),
      round2: panelBoard(2, [["0001", 3]], false),
      cut: 1,
    });
    expect(topPlaces(open)).toEqual([]);
  });
});

describe("standingsPublishable", () => {
  const round1 = round1Of([
    ["0001", 1],
    ["0002", null],
  ]);

  it("is true once round 1 has drawn a field and round 2 is complete", () => {
    expect(standingsPublishable({ round1, round2: panelBoard(2, [["0001", 3]]), cut: 1 })).toBe(
      true
    );
  });

  it("is false while round 2 is open", () => {
    expect(
      standingsPublishable({ round1, round2: panelBoard(2, [["0001", 3]], false), cut: 1 })
    ).toBe(false);
  });

  it("is false when round 1 has ranked nobody", () => {
    expect(
      standingsPublishable({
        round1: round1Of([["0001", null]]),
        round2: panelBoard(2, [["0001", 3]]),
        cut: 1,
      })
    ).toBe(false);
  });

  it("is false when the cut admits nobody", () => {
    expect(standingsPublishable({ round1, round2: panelBoard(2, [["0001", 3]]), cut: 0 })).toBe(
      false
    );
  });
});
