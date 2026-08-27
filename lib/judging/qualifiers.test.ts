import { describe, expect, it } from "vitest";

import { qualifierNotice, qualifierUnits } from "./qualifiers";
import type { QualifierRow } from "./types";

/**
 * What happens to a qualifying field once it exists.
 *
 * Drawing the field is `cut.ts`' job and is tested there. These fixtures are built
 * by hand rather than by running the cut, so a change to the cut rule cannot
 * silently change what these tests are asserting about round 2's unit set.
 */

/** Qualifiers stated directly, as `[code, round1Rank]` pairs. */
function qualifiersOf(entries: [code: string, rank: number][]): QualifierRow[] {
  return entries.map(([code, rank]) => ({
    unitKey: `u-${code}`,
    code,
    entryId: `e-${code}`,
    participantId: `p-${code}`,
    round1Points: rank,
    round1Rank: rank,
  }));
}

/** The first `count` codes, ranked 1..count. */
function cleanField(count: number): QualifierRow[] {
  return qualifiersOf(
    Array.from({ length: count }, (_, i) => [String(i + 1).padStart(4, "0"), i + 1])
  );
}

describe("qualifierUnits", () => {
  it("hands round 2 its unit set", () => {
    expect(qualifierUnits(cleanField(3))).toEqual([
      { unitKey: "u-0001", code: "0001", entryId: "e-0001", participantId: "p-0001" },
      { unitKey: "u-0002", code: "0002", entryId: "e-0002", participantId: "p-0002" },
      { unitKey: "u-0003", code: "0003", entryId: "e-0003", participantId: "p-0003" },
    ]);
  });

  it("drops round 1's points, so round 2 cannot accidentally sum them", () => {
    // Round 2's points are the three judges' ranks and nothing else; round 1
    // rejoins only in `finalStandings`. A unit carrying round1Points into
    // `consolidateRound` would be double-counted there (N4).
    const units = qualifierUnits(cleanField(1));
    expect(units[0]).not.toHaveProperty("round1Points");
    expect(units[0]).not.toHaveProperty("round1Rank");
  });

  it("keeps the qualifiers' order, so round 2's sheet opens in round 1 order", () => {
    const shuffled = qualifiersOf([
      ["0003", 1],
      ["0001", 2],
      ["0002", 3],
    ]);
    expect(qualifierUnits(shuffled).map((u) => u.code)).toEqual(["0003", "0001", "0002"]);
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
    expect(qualifierNotice(cleanField(10), 10)).toBeNull();
  });

  it("explains a field larger than the cut, and names the tie", () => {
    const notice = qualifierNotice(
      qualifiersOf([
        ["0001", 1],
        ["0002", 2],
        ["0003", 2],
        ["0004", 2],
      ]),
      2
    );
    expect(notice).toContain("4 qualify");
    expect(notice).toContain("cut of 2");
    // A judge counting four rows under a cut of two needs to be told why, or
    // they will assume the portal is broken.
    expect(notice).toContain("3 contestants are level");
  });

  it("names the rank the tie sits on, not just its size", () => {
    const notice = qualifierNotice(
      qualifiersOf([
        ["0001", 1],
        ["0002", 2],
        ["0003", 2],
      ]),
      2
    );
    expect(notice).toContain("rank 2");
  });

  it("explains an oversized field with no tie on the cut line", () => {
    // Cannot arise from the cut rule, but the sentence must still read as English
    // rather than trailing off after a count of one.
    const notice = qualifierNotice(cleanField(3), 2);
    expect(notice).toContain("3 qualify");
    expect(notice).not.toContain("level on rank");
  });

  it("explains a field smaller than the cut", () => {
    expect(qualifierNotice(cleanField(2), 10)).toContain("fewer than the cut");
  });

  it("explains an empty field rather than staying silent", () => {
    // Round 1 submitted with nothing ranked. Silence here would read as a field
    // of the right size that simply failed to render.
    expect(qualifierNotice([], 10)).toContain("0 qualify");
  });
});
