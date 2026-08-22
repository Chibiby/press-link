import { describe, expect, it } from "vitest";

import { competitionRank } from "./consolidate";
import {
  DEFAULT_ROUND2_CUT,
  qualifierNotice,
  qualifierUnits,
  selectQualifiers,
} from "./qualifiers";
import type { BoardRow, ConsolidatedBoard } from "./types";

/**
 * A round-1 board built straight from points, so a test can state the standings
 * it means without threading a whole panel through. Ranks come from the real
 * `competitionRank`, so the fixture cannot disagree with production about ties.
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

/** Twelve contestants, no ties: points 1 through 12. */
const CLEAN = boardOf(
  Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(4, "0"), i + 1] as [string, number])
);

describe("selectQualifiers", () => {
  it("takes exactly the cut when nothing is tied", () => {
    const qualifiers = selectQualifiers(CLEAN, 10);
    expect(qualifiers).toHaveLength(10);
    expect(qualifiers.map((q) => q.round1Rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("admits the contestant sitting exactly on the cut", () => {
    expect(selectQualifiers(CLEAN, 10).at(-1)?.round1Rank).toBe(10);
  });

  it("excludes the contestant one place below the cut", () => {
    const codes = selectQualifiers(CLEAN, 10).map((q) => q.code);
    expect(codes).not.toContain("0011");
  });

  it("carries round 1's points and rank forward", () => {
    const first = selectQualifiers(CLEAN, 3)[0];
    expect(first).toMatchObject({ code: "0001", round1Points: 1, round1Rank: 1 });
  });

  it("returns qualifiers in rank order", () => {
    const ranks = selectQualifiers(CLEAN, 5).map((q) => q.round1Rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe("selectQualifiers — a tie on the cut (D3)", () => {
  // Nine clear places, then three contestants level on points. All three read
  // rank 10.
  const TIED = boardOf([
    ["0001", 1],
    ["0002", 2],
    ["0003", 3],
    ["0004", 4],
    ["0005", 5],
    ["0006", 6],
    ["0007", 7],
    ["0008", 8],
    ["0009", 9],
    ["0010", 20],
    ["0011", 20],
    ["0012", 20],
    ["0013", 30],
  ]);

  it("qualifies twelve under a cut of ten", () => {
    // The headline case. Not an overflow to trim — the three are level on points
    // and round 1 holds no fact that separates them, so trimming to ten would be
    // a coin toss deciding who competes for the title.
    expect(selectQualifiers(TIED, 10)).toHaveLength(12);
  });

  it("takes all three tied contestants or none", () => {
    const codes = selectQualifiers(TIED, 10).map((c) => c.code);
    expect(codes).toContain("0010");
    expect(codes).toContain("0011");
    expect(codes).toContain("0012");
  });

  it("still stops at the next distinct rank", () => {
    // Rank 13 sits below the tie because of the gap. It must not be swept in.
    expect(selectQualifiers(TIED, 10).map((c) => c.code)).not.toContain("0013");
  });

  it("does not smuggle the tie in under a cut of nine", () => {
    const qualifiers = selectQualifiers(TIED, 9);
    expect(qualifiers).toHaveLength(9);
    expect(qualifiers.map((q) => q.code)).not.toContain("0010");
  });

  it("orders the tied rows by code, deterministically", () => {
    const tied = selectQualifiers(TIED, 10).filter((q) => q.round1Rank === 10);
    expect(tied.map((q) => q.code)).toEqual(["0010", "0011", "0012"]);
  });
});

describe("selectQualifiers — edges", () => {
  it("qualifies the whole field when the cut exceeds it", () => {
    expect(selectQualifiers(CLEAN, 50)).toHaveLength(12);
  });

  it("qualifies nobody on a cut of zero or less", () => {
    expect(selectQualifiers(CLEAN, 0)).toEqual([]);
    expect(selectQualifiers(CLEAN, -3)).toEqual([]);
  });

  it("qualifies nobody from an incomplete round 1", () => {
    // No branch does this: an incomplete board reports rank null on every row and
    // null passes no comparison. Pinned because it is the safety net under a
    // caller who forgets to check board.complete.
    const partial = boardOf(
      [
        ["0001", 1],
        ["0002", 2],
      ],
      false
    );
    expect(selectQualifiers(partial, 10)).toEqual([]);
  });

  it("qualifies nobody from an empty event", () => {
    expect(selectQualifiers(boardOf([]), 10)).toEqual([]);
  });

  it("defaults the cut to ten", () => {
    expect(DEFAULT_ROUND2_CUT).toBe(10);
  });
});

describe("qualifierUnits", () => {
  it("hands round 2 its unit set", () => {
    const units = qualifierUnits(selectQualifiers(CLEAN, 3));
    expect(units).toEqual([
      { unitKey: "u-0001", code: "0001", entryId: "e-0001", participantId: "p-0001" },
      { unitKey: "u-0002", code: "0002", entryId: "e-0002", participantId: "p-0002" },
      { unitKey: "u-0003", code: "0003", entryId: "e-0003", participantId: "p-0003" },
    ]);
  });

  it("drops round 1's points, so round 2 cannot accidentally sum them", () => {
    const units = qualifierUnits(selectQualifiers(CLEAN, 1));
    expect(units[0]).not.toHaveProperty("round1Points");
    expect(units[0]).not.toHaveProperty("round1Rank");
  });

  it("keeps a group unit's null participant", () => {
    const units = qualifierUnits([
      {
        unitKey: "e-1",
        code: "0001",
        entryId: "e-1",
        participantId: null,
        round1Points: 1,
        round1Rank: 1,
      },
    ]);
    expect(units[0].participantId).toBeNull();
    expect(units[0].unitKey).toBe("e-1");
  });

  it("is empty when nobody qualified", () => {
    expect(qualifierUnits([])).toEqual([]);
  });
});

describe("qualifierNotice", () => {
  it("says nothing when the field is exactly the cut", () => {
    expect(qualifierNotice(selectQualifiers(CLEAN, 10), 10)).toBeNull();
  });

  it("explains a field larger than the cut, and names the tie", () => {
    const TIED = boardOf([
      ["0001", 1],
      ["0002", 20],
      ["0003", 20],
      ["0004", 20],
    ]);
    const notice = qualifierNotice(selectQualifiers(TIED, 2), 2);
    expect(notice).toContain("4 qualify");
    expect(notice).toContain("cut of 2");
    // A judge counting four rows under a cut of two needs to be told why, or
    // they will assume the portal is broken.
    expect(notice).toContain("3 contestants are level");
  });

  it("explains a field smaller than the cut", () => {
    const small = boardOf([
      ["0001", 1],
      ["0002", 2],
    ]);
    expect(qualifierNotice(selectQualifiers(small, 10), 10)).toContain("fewer than the cut");
  });
});
