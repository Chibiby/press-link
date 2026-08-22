import { describe, expect, it } from "vitest";

import { isJudgingRound, parseJudgingRound, ROUND_LABEL, ROUND_SCOPE, ROUNDS } from "./round";

describe("ROUNDS", () => {
  it("has exactly two rounds", () => {
    // D4: round 1 selects, round 2 decides. A third round would change the
    // meaning of finalStandings, so this is a contract and not a detail.
    expect(ROUNDS).toEqual([1, 2]);
  });

  it("labels and scopes every round", () => {
    for (const round of ROUNDS) {
      expect(ROUND_LABEL[round].length).toBeGreaterThan(0);
      expect(ROUND_SCOPE[round].length).toBeGreaterThan(0);
    }
  });

  it("tells a judge that round 2 is narrower", () => {
    // The scope line is the only thing that explains a shorter list, so it has
    // to actually say so rather than repeating the label.
    expect(ROUND_SCOPE[2].toLowerCase()).toContain("qualifier");
  });
});

describe("isJudgingRound", () => {
  it("accepts both rounds as numbers", () => {
    expect(isJudgingRound(1)).toBe(true);
    expect(isJudgingRound(2)).toBe(true);
  });

  it("accepts both rounds as strings, because every real caller is a URL or a form", () => {
    expect(isJudgingRound("1")).toBe(true);
    expect(isJudgingRound("2")).toBe(true);
  });

  it("rejects a third round", () => {
    expect(isJudgingRound(3)).toBe(false);
    expect(isJudgingRound("3")).toBe(false);
    expect(isJudgingRound(0)).toBe(false);
  });

  it("rejects a blank field rather than reading it as round 1", () => {
    // Number("") is 0, not NaN, so a guard that converted first would have to
    // remember this. Testing the shape first is why it does not.
    expect(isJudgingRound("")).toBe(false);
    expect(isJudgingRound(" ")).toBe(false);
  });

  it("rejects a padded field", () => {
    // Number(" 1 ") is 1. A padded value is a malformed request, and accepting
    // it would mean two spellings of the same round reach the RPC.
    expect(isJudgingRound(" 1")).toBe(false);
    expect(isJudgingRound("1 ")).toBe(false);
    expect(isJudgingRound("01")).toBe(false);
  });

  it("rejects the values that coerce to 1 in JavaScript", () => {
    // Each of these is Number()-equal to 1. The guard checks the type before
    // converting precisely so none of them can pass as a round.
    expect(isJudgingRound(true)).toBe(false);
    expect(isJudgingRound([1])).toBe(false);
    expect(isJudgingRound(1.0000001)).toBe(false);
  });

  it("rejects nothing at all", () => {
    expect(isJudgingRound(null)).toBe(false);
    expect(isJudgingRound(undefined)).toBe(false);
    expect(isJudgingRound({})).toBe(false);
  });
});

describe("parseJudgingRound", () => {
  it("converts a string round to a number", () => {
    expect(parseJudgingRound("2")).toBe(2);
  });

  it("passes a number round straight through", () => {
    expect(parseJudgingRound(1)).toBe(1);
  });

  it("returns null rather than defaulting to round 1", () => {
    // Defaulting would hide a bad link behind a working page, and a judge would
    // rank round 1 believing they were ranking round 2.
    expect(parseJudgingRound("nonsense")).toBeNull();
    expect(parseJudgingRound(undefined)).toBeNull();
  });
});
