import { describe, expect, it } from "vitest";

import { competitionRank } from "./consolidate";
import {
  finalStandings,
  standingsPublishable,
  topPlaces,
  TOTAL_RANK_NOTE,
} from "./standings";
import type { BoardRow, ConsolidatedBoard, JudgingRound } from "./types";

/** A consolidated board stated as points, with ranks from the real rank function. */
function board(
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
  return { round, rows, judgeIds: ["j1"], complete, missing: [] };
}

const byCode = (rows: { code: string }[]) => rows.map((r) => r.code);

describe("finalStandings — round 2 alone decides the winners (D4)", () => {
  // Six contestants, cut of three. Round 1's order is 1..6. Round 2 reverses the
  // three qualifiers exactly.
  const round1 = board(1, [
    ["0001", 3],
    ["0002", 5],
    ["0003", 7],
    ["0004", 9],
    ["0005", 11],
    ["0006", 13],
  ]);
  const round2 = board(2, [
    ["0001", 6],
    ["0002", 4],
    ["0003", 2],
  ]);
  const rows = finalStandings({ round1, round2, cut: 3 });
  const rankOf = Object.fromEntries(rows.map((r) => [r.code, r.finalRank]));

  it("crowns round 2's winner, not round 1's leader", () => {
    expect(rankOf["0003"]).toBe(1);
  });

  it("drops round 1's leader to last of the qualifiers", () => {
    // 0001 topped round 1 and placed third of three in round 2. Round 1 selected
    // the field and then stopped counting.
    expect(rankOf["0001"]).toBe(3);
  });

  it("orders the qualifiers by round 2 exactly", () => {
    expect(byCode(rows.slice(0, 3))).toEqual(["0003", "0002", "0001"]);
  });

  it("returns rows in final-rank order", () => {
    expect(rows.map((r) => r.finalRank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("computes an identical total rank for three different final ranks", () => {
    // The clearest possible demonstration that totalRank decides nothing: all
    // three qualifiers total 4, and they finish first, second and third. A sheet
    // that sorted by this column would produce an arbitrary order.
    expect(rows.slice(0, 3).map((r) => r.totalRank)).toEqual([4, 4, 4]);
    expect(rows.slice(0, 3).map((r) => r.finalRank)).toEqual([1, 2, 3]);
  });

  it("marks who qualified", () => {
    expect(rows.filter((r) => r.qualified).map((r) => r.code)).toEqual([
      "0003",
      "0002",
      "0001",
    ]);
  });

  it("carries both rounds' points and ranks", () => {
    const winner = rows[0];
    expect(winner).toMatchObject({
      code: "0003",
      round1Points: 7,
      round1Rank: 3,
      round2Points: 2,
      round2Rank: 1,
    });
  });
});

describe("finalStandings — a round-2 tie", () => {
  const round1 = board(1, [
    ["0001", 2],
    ["0002", 4],
    ["0003", 6],
    ["0004", 8],
  ]);
  const round2 = board(2, [
    ["0001", 5],
    ["0002", 5],
  ]);
  const rows = finalStandings({ round1, round2, cut: 2 });
  const rankOf = Object.fromEntries(rows.map((r) => [r.code, r.finalRank]));

  it("breaks it on the better round-1 points", () => {
    expect(rankOf["0001"]).toBe(1);
    expect(rankOf["0002"]).toBe(2);
  });

  it("still reports a shared rank in the round-2 column", () => {
    // round2Rank and finalRank are different questions. Round 2 genuinely placed
    // these two level; the final order needed a tie-break and found one. Showing
    // 1 and 1 in the round-2 column beside 1 and 2 in the final column is
    // correct, and a page that reused one for the other would be lying about one
    // of them.
    const round2Ranks = Object.fromEntries(rows.map((r) => [r.code, r.round2Rank]));
    expect(round2Ranks["0001"]).toBe(1);
    expect(round2Ranks["0002"]).toBe(1);
  });
});

describe("finalStandings — level on both rounds is a shared place", () => {
  const round1 = board(1, [
    ["0001", 4],
    ["0002", 4],
    ["0003", 8],
    ["0004", 12],
  ]);
  const round2 = board(2, [
    ["0001", 3],
    ["0002", 3],
    ["0003", 6],
  ]);
  // Round-1 ranks are 1, 1, 3, 4 — so a cut of 3 admits the first three.
  const rows = finalStandings({ round1, round2, cut: 3 });
  const rankOf = Object.fromEntries(rows.map((r) => [r.code, r.finalRank]));

  it("gives both contestants the same final rank", () => {
    // Two performances the panel could not separate in either round. Inventing a
    // winner here would mean code order deciding a title.
    expect(rankOf["0001"]).toBe(1);
    expect(rankOf["0002"]).toBe(1);
  });

  it("leaves the gap after the shared place", () => {
    expect(rankOf["0003"]).toBe(3);
  });

  it("starts the non-qualifiers after the qualifier count, not after the last rank", () => {
    // Three qualified and the highest qualifier rank is 3, so 4 is right either
    // way here; the offset is on the count because competition ranking over n
    // rows can never exceed n, which is what makes the two agree.
    expect(rankOf["0004"]).toBe(4);
  });
});

describe("finalStandings — non-qualifiers", () => {
  const round1 = board(1, [
    ["0001", 2],
    ["0002", 4],
    ["0003", 6],
    ["0004", 6],
    ["0005", 20],
  ]);
  const round2 = board(2, [
    ["0001", 2],
    ["0002", 1],
  ]);
  const rows = finalStandings({ round1, round2, cut: 2 });
  const rankOf = Object.fromEntries(rows.map((r) => [r.code, r.finalRank]));

  it("places every non-qualifier below every qualifier", () => {
    const worstQualifier = Math.max(
      ...rows.filter((r) => r.qualified).map((r) => r.finalRank as number)
    );
    const bestNonQualifier = Math.min(
      ...rows.filter((r) => !r.qualified).map((r) => r.finalRank as number)
    );
    expect(bestNonQualifier).toBeGreaterThan(worstQualifier);
  });

  it("starts the block at the qualifier count plus one", () => {
    expect(rankOf["0003"]).toBe(3);
  });

  it("orders them by round-1 points", () => {
    expect(byCode(rows.filter((r) => !r.qualified))).toEqual(["0003", "0004", "0005"]);
  });

  it("shares a place inside the block when round-1 points are level", () => {
    expect(rankOf["0003"]).toBe(3);
    expect(rankOf["0004"]).toBe(3);
    expect(rankOf["0005"]).toBe(5);
  });

  it("gives them no round-2 figures at all", () => {
    for (const row of rows.filter((r) => !r.qualified)) {
      expect(row.round2Points).toBeNull();
      expect(row.round2Rank).toBeNull();
      expect(row.totalRank).toBeNull();
    }
  });

  it("does not let a strong round 1 outrank a qualifier", () => {
    // 0003 lost the cut by one place. It cannot finish above 0001 or 0002 however
    // close its round-1 points were.
    expect(rankOf["0003"]).toBeGreaterThan(rankOf["0001"] as number);
  });
});

describe("finalStandings — a twelve-strong field under a cut of ten", () => {
  const round1 = board(1, [
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
  const round2 = board(
    2,
    Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(4, "0"), i + 1] as [string, number])
  );
  const rows = finalStandings({ round1, round2, cut: 10 });

  it("qualifies twelve", () => {
    expect(rows.filter((r) => r.qualified)).toHaveLength(12);
  });

  it("starts the single non-qualifier at 13, not 11", () => {
    // The block offset is the qualifier count. Offsetting by the cut instead would
    // put this contestant at 11, level with two people who reached round 2.
    const last = rows.find((r) => r.code === "0013");
    expect(last?.finalRank).toBe(13);
  });

  it("leaves no gap and no collision between the blocks", () => {
    expect(rows.map((r) => r.finalRank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });
});

describe("finalStandings — incomplete rounds", () => {
  const round1Rows: [string, number][] = [
    ["0001", 2],
    ["0002", 4],
    ["0003", 6],
  ];

  it("ranks nothing at all while round 1 is open", () => {
    const rows = finalStandings({
      round1: board(1, round1Rows, false),
      round2: board(2, [], false),
      cut: 2,
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.round1Rank).toBeNull();
      expect(row.finalRank).toBeNull();
      expect(row.totalRank).toBeNull();
      expect(row.qualified).toBe(false);
    }
  });

  it("settles the non-qualifiers as soon as round 1 closes", () => {
    // Their placement never depended on round 2, so making them wait would hide
    // information the tabulators already have.
    const rows = finalStandings({
      round1: board(1, round1Rows),
      round2: board(2, [["0001", 1]], false),
      cut: 2,
    });
    expect(rows.find((r) => r.code === "0003")?.finalRank).toBe(3);
  });

  it("leaves the qualifiers unranked while round 2 is open", () => {
    const rows = finalStandings({
      round1: board(1, round1Rows),
      round2: board(2, [["0001", 1]], false),
      cut: 2,
    });
    for (const row of rows.filter((r) => r.qualified)) {
      expect(row.round2Rank).toBeNull();
      expect(row.finalRank).toBeNull();
      expect(row.totalRank).toBeNull();
    }
  });

  it("still reports round 1's ranks for the qualifiers", () => {
    const rows = finalStandings({
      round1: board(1, round1Rows),
      round2: board(2, [], false),
      cut: 2,
    });
    expect(rows.find((r) => r.code === "0001")?.round1Rank).toBe(1);
  });

  it("orders unranked rows by round 1 so the table does not jump about", () => {
    const rows = finalStandings({
      round1: board(1, round1Rows),
      round2: board(2, [], false),
      cut: 2,
    });
    expect(byCode(rows)).toEqual(["0001", "0002", "0003"]);
  });

  it("keeps the qualifiers at the top while round 2 is open", () => {
    // The hazard the qualified-first sort exists for. Mid-round-2 the eliminated
    // contestants have settled final ranks and the contenders have none, so
    // ordering on rank alone would float the eliminated to the top of the sheet
    // while the title is still being decided.
    const rows = finalStandings({
      round1: board(1, round1Rows),
      round2: board(2, [["0001", 1]], false),
      cut: 2,
    });
    expect(byCode(rows)).toEqual(["0001", "0002", "0003"]);
    expect(rows[2].finalRank).toBe(3);
    expect(rows[0].finalRank).toBeNull();
  });

  it("handles an event with no contestants", () => {
    expect(finalStandings({ round1: board(1, []), round2: board(2, []), cut: 10 })).toEqual([]);
  });
});

describe("topPlaces", () => {
  const round1 = board(1, [
    ["0001", 2],
    ["0002", 4],
    ["0003", 6],
    ["0004", 8],
  ]);
  const round2 = board(2, [
    ["0001", 3],
    ["0002", 3],
    ["0003", 9],
    ["0004", 12],
  ]);
  const rows = finalStandings({ round1, round2, cut: 4 });

  it("returns the top three by default", () => {
    expect(topPlaces(rows)).toHaveLength(3);
  });

  it("counts places, not rows, so a shared place returns both contestants", () => {
    // 0001 and 0002 are level on round 2 but 0001 had the better round 1, so they
    // are ranks 1 and 2 here. Make a genuine shared place and ask for one place.
    const shared = finalStandings({
      round1: board(1, [
        ["0001", 4],
        ["0002", 4],
      ]),
      round2: board(2, [
        ["0001", 3],
        ["0002", 3],
      ]),
      cut: 2,
    });
    expect(topPlaces(shared, 1)).toHaveLength(2);
  });

  it("returns nothing when nothing is ranked", () => {
    const open = finalStandings({
      round1: board(1, [["0001", 2]], false),
      round2: board(2, [], false),
      cut: 2,
    });
    expect(topPlaces(open)).toEqual([]);
  });
});

describe("standingsPublishable", () => {
  const complete = board(1, [["0001", 1]]);
  const open = board(2, [["0001", 1]], false);

  it("requires both rounds", () => {
    expect(standingsPublishable({ round1: complete, round2: board(2, [["0001", 1]]), cut: 1 })).toBe(
      true
    );
    expect(standingsPublishable({ round1: complete, round2: open, cut: 1 })).toBe(false);
    expect(standingsPublishable({ round1: board(1, [["0001", 1]], false), round2: open, cut: 1 })).toBe(
      false
    );
  });
});

describe("TOTAL_RANK_NOTE", () => {
  it("says the column is informational and names what decides the result", () => {
    // Non-negotiable 6 lives in this constant. If a page prints a total-rank
    // column without it, a tabulator will reasonably assume the column is the
    // result.
    expect(TOTAL_RANK_NOTE.toLowerCase()).toContain("informational");
    expect(TOTAL_RANK_NOTE.toLowerCase()).toContain("round 2");
  });
});
