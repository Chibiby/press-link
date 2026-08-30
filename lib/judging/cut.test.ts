import { describe, expect, it } from "vitest";

import { competitionRank } from "./consolidate";
import {
  DEFAULT_ROUND2_CUT,
  MAX_ROUND2_CUT,
  round1Board,
  round1Qualifiers,
  selectQualifiers,
} from "./cut";
import { ROUND1_RANK_LIMIT } from "./sheet-form";
import type { BoardRow, ConsolidatedBoard, ContestUnit, JudgeRank } from "./types";

/**
 * Round 1's rules: the cut.
 *
 * The distinction these tests exist to hold is that a blank is an **answer**, not
 * an absence (N2). `consolidate.ts` reads an unranked unit as a panel that has not
 * finished; here it is a contestant the judge eliminated, and the two readings
 * produce opposite outcomes from the same row.
 */

const CODES = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(4, "0"));

function unitsOf(codes: string[]): ContestUnit[] {
  return codes.map((code) => ({
    unitKey: `u-${code}`,
    code,
    entryId: `e-${code}`,
    participantId: `p-${code}`,
  }));
}

/** One judge's sheet, as `[code, rank]` pairs. Absent codes are blanks. */
function ranksOf(entries: [code: string, rank: number][], judgeId = "j1"): JudgeRank[] {
  return entries.map(([code, rank]) => ({ judgeId, unitKey: `u-${code}`, rank }));
}

/** The first `count` codes ranked 1..count — a clean cut with no ties. */
function cleanSheet(count: number): JudgeRank[] {
  return ranksOf(CODES.slice(0, count).map((code, i) => [code, i + 1]));
}

const UNITS = unitsOf(CODES);

describe("round1Board", () => {
  it("carries the judge's rank on the rows they ranked", () => {
    const board = round1Board(UNITS, cleanSheet(10));
    expect(board.rows.slice(0, 10).map((row) => row.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("reads an unranked contestant as a blank, not as an outstanding rank", () => {
    const board = round1Board(UNITS, cleanSheet(10));
    const blanks = board.rows.filter((row) => row.rank === null);
    expect(blanks).toHaveLength(2);
    expect(blanks.map((row) => row.code)).toEqual(["0011", "0012"]);
  });

  it("counts the scored rows, which under N2 is the qualifier count", () => {
    expect(round1Board(UNITS, cleanSheet(10)).scored).toBe(10);
  });

  it("keeps a tie exactly as the judge typed it — no competition renumber (N3)", () => {
    // The headline of N3. Competition ranking would turn 1, 2, 2, 3 into
    // 1, 2, 2, 4 and move a contestant the judge deliberately levelled. Round 1
    // selects a field; the placements inside it decide nothing on their own.
    const board = round1Board(
      UNITS,
      ranksOf([
        ["0001", 1],
        ["0002", 2],
        ["0003", 2],
        ["0004", 3],
      ])
    );
    expect(board.rows.slice(0, 4).map((row) => row.rank)).toEqual([1, 2, 2, 3]);
  });

  it("orders by rank, then by code inside a tie", () => {
    const board = round1Board(
      UNITS,
      ranksOf([
        ["0003", 2],
        ["0002", 2],
        ["0001", 1],
      ])
    );
    expect(board.rows.slice(0, 3).map((row) => row.code)).toEqual(["0001", "0002", "0003"]);
  });

  it("sorts blanks last, never above the field they lost to", () => {
    const board = round1Board(UNITS, ranksOf([["0012", 1]]));
    expect(board.rows[0].code).toBe("0012");
    expect(board.rows.at(-1)?.rank).toBeNull();
  });

  it("names the judge whose sheet it read", () => {
    expect(round1Board(UNITS, ranksOf([["0001", 1]], "seat-1")).judgeId).toBe("seat-1");
  });

  it("has no judge when nothing has been ranked", () => {
    const board = round1Board(UNITS, []);
    expect(board.judgeId).toBeNull();
    expect(board.scored).toBe(0);
    expect(board.rows).toHaveLength(12);
  });

  it("drops a rank for a unit that is not in the event", () => {
    // An entry deleted after the sheet was filed. The stale row must not appear as
    // a thirteenth contestant.
    const board = round1Board(UNITS, ranksOf([["9999", 1]]));
    expect(board.rows).toHaveLength(12);
    expect(board.scored).toBe(0);
  });

  it("keeps the first of two ranks for the same unit, so two reads agree", () => {
    const board = round1Board(UNITS, [
      { judgeId: "j1", unitKey: "u-0001", rank: 1 },
      { judgeId: "j1", unitKey: "u-0001", rank: 5 },
    ]);
    expect(board.rows[0]).toMatchObject({ code: "0001", rank: 1 });
  });

  it("ranks a group unit by its entry, with a null participant", () => {
    const board = round1Board(
      [{ unitKey: "e-1", code: "0001", entryId: "e-1", participantId: null }],
      [{ judgeId: "j1", unitKey: "e-1", rank: 1 }]
    );
    expect(board.rows[0]).toMatchObject({ unitKey: "e-1", participantId: null, rank: 1 });
  });
});

describe("round1Qualifiers", () => {
  it("qualifies exactly the scored contestants", () => {
    const board = round1Board(UNITS, cleanSheet(10));
    const qualifiers = round1Qualifiers(board, 10);
    expect(qualifiers).toHaveLength(10);
    expect(qualifiers.map((q) => q.round1Rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("excludes every blank", () => {
    const codes = round1Qualifiers(round1Board(UNITS, cleanSheet(10)), 10).map((q) => q.code);
    expect(codes).not.toContain("0011");
    expect(codes).not.toContain("0012");
  });

  it("admits the contestant sitting exactly on the cut", () => {
    expect(round1Qualifiers(round1Board(UNITS, cleanSheet(10)), 10).at(-1)?.round1Rank).toBe(10);
  });

  it("carries round 1's rank forward as both its points and its rank", () => {
    // One judge, so the round's points and its rank are the same figure (N1).
    const first = round1Qualifiers(round1Board(UNITS, cleanSheet(3)), 3)[0];
    expect(first).toMatchObject({ code: "0001", round1Points: 1, round1Rank: 1 });
  });

  it("returns qualifiers in rank order", () => {
    const ranks = round1Qualifiers(round1Board(UNITS, cleanSheet(5)), 5).map((q) => q.round1Rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("qualifies nobody from an unranked event", () => {
    expect(round1Qualifiers(round1Board(UNITS, []), 10)).toEqual([]);
  });

  it("qualifies nobody from an empty event", () => {
    expect(round1Qualifiers(round1Board([], cleanSheet(0)), 10)).toEqual([]);
  });

  it("qualifies nobody on a cut of zero or less", () => {
    const board = round1Board(UNITS, cleanSheet(10));
    expect(round1Qualifiers(board, 0)).toEqual([]);
    expect(round1Qualifiers(board, -3)).toEqual([]);
  });

  it("drops a rank above a cut an admin lowered after the sheet was filed", () => {
    // The dropdown cannot offer a rank above the cut, so this cannot arise from a
    // judge. It arises from an admin lowering events.round2_cut, and a rank that
    // was legal once must stop qualifying rather than sneak through.
    const board = round1Board(UNITS, cleanSheet(10));
    expect(round1Qualifiers(board, 5)).toHaveLength(5);
  });
});

describe("round1Qualifiers — a tie at the cut line (D3, N3)", () => {
  // Nine clear places, then three contestants the judge levelled on rank 10, then
  // one more below them.
  const TIED = round1Board(
    UNITS,
    ranksOf([
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
    ])
  );

  it("qualifies twelve under a cut of ten", () => {
    // The headline case. Not an overflow to trim — the three are level and round 1
    // holds no fact that separates them, so trimming to ten would be a coin toss
    // deciding who competes for the title.
    expect(round1Qualifiers(TIED, 10)).toHaveLength(12);
  });

  it("takes all three tied contestants or none", () => {
    const codes = round1Qualifiers(TIED, 10).map((q) => q.code);
    expect(codes).toContain("0010");
    expect(codes).toContain("0011");
    expect(codes).toContain("0012");
  });

  it("does not smuggle the tie in under a cut of nine", () => {
    const qualifiers = round1Qualifiers(TIED, 9);
    expect(qualifiers).toHaveLength(9);
    expect(qualifiers.map((q) => q.code)).not.toContain("0010");
  });

  it("orders the tied rows by code, deterministically", () => {
    const tied = round1Qualifiers(TIED, 10).filter((q) => q.round1Rank === 10);
    expect(tied.map((q) => q.code)).toEqual(["0010", "0011", "0012"]);
  });
});

describe("round1Qualifiers — a field smaller than the cut", () => {
  it("qualifies the whole field when the judge scored fewer than the cut allows", () => {
    expect(round1Qualifiers(round1Board(UNITS, cleanSheet(4)), 10)).toHaveLength(4);
  });

  it("qualifies the whole field when the event has fewer contestants than the cut", () => {
    const small = unitsOf(["0001", "0002"]);
    const board = round1Board(
      small,
      ranksOf([
        ["0001", 1],
        ["0002", 2],
      ])
    );
    expect(round1Qualifiers(board, 10)).toHaveLength(2);
  });
});

describe("selectQualifiers — the consolidated-board path", () => {
  /**
   * A consolidated board built straight from points, so a test can state the
   * standings it means without threading a whole panel through. Ranks come from
   * the real `competitionRank`, so the fixture cannot disagree with production
   * about ties.
   */
  function boardOf(entries: [code: string, points: number][], complete = true): ConsolidatedBoard {
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
    return { round: 1, rows, judgeIds: ["j1"], complete, missing: [] };
  }

  const CLEAN = boardOf(CODES.map((code, i) => [code, i + 1]));

  it("applies the same cut to a panel board", () => {
    expect(selectQualifiers(CLEAN, 10)).toHaveLength(10);
  });

  it("keeps a panel's summed points rather than overwriting them with the rank", () => {
    // Nine clear places then a tie, so points (20) and rank (10) differ. A row
    // that reported its rank as its points would hide how the placement was made.
    const TIED = boardOf([
      ["0001", 1],
      ["0002", 20],
      ["0003", 20],
    ]);
    const tied = selectQualifiers(TIED, 2).filter((q) => q.round1Rank === 2);
    expect(tied.map((q) => q.round1Points)).toEqual([20, 20]);
  });

  it("qualifies nobody from an incomplete panel", () => {
    // No branch does this: an incomplete board reports rank null on every row
    // (non-negotiable 4) and a null rank is read here as no rank. Pinned because
    // it is the safety net under a caller who forgets to check board.complete.
    const partial = boardOf(
      [
        ["0001", 1],
        ["0002", 2],
      ],
      false
    );
    expect(selectQualifiers(partial, 10)).toEqual([]);
  });
});

describe("the cut's default and ceiling", () => {
  it("defaults the cut to thirty", () => {
    expect(DEFAULT_ROUND2_CUT).toBe(30);
  });

  it("holds the ceiling at the round 1 rank limit, which it cannot exceed", () => {
    // A cut above what seat 1 can type would admit ranks round 1 has no way to
    // record: the qualifier list is drawn from the sheet, not from the number.
    expect(MAX_ROUND2_CUT).toBe(ROUND1_RANK_LIMIT);
    expect(DEFAULT_ROUND2_CUT).toBeLessThanOrEqual(MAX_ROUND2_CUT);
  });
});
