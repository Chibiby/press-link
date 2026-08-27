import { describe, expect, it } from "vitest";

import { sheetEntryState, type SheetEntryFacts } from "./sheet-entry";
import type { EventRoundState } from "./types";

const OPEN: EventRoundState = {
  round1ClosedAt: null,
  round1LockedAt: null,
  round2CutUsed: null,
  resultsLockedAt: null,
};

const ROUND1_LOCKED: EventRoundState = {
  round1ClosedAt: "2026-08-27T01:00:00Z",
  round1LockedAt: "2026-08-27T01:00:00Z",
  round2CutUsed: 10,
  resultsLockedAt: null,
};

const PUBLISHED: EventRoundState = { ...ROUND1_LOCKED, resultsLockedAt: "2026-08-27T04:00:00Z" };

function facts(over: Partial<SheetEntryFacts> = {}): SheetEntryFacts {
  return {
    individual: true,
    seat: 1,
    round: 1,
    rounds: OPEN,
    submittedAt: null,
    ...over,
  };
}

describe("sheetEntryState", () => {
  it("lets an admin type seat 1's round 1 sheet while round 1 is open", () => {
    const state = sheetEntryState(facts());
    expect(state.canEnter).toBe(true);
    expect(state.reason).toContain("paper sheet");
  });

  it("lets an admin type a round 2 sheet once round 1 is locked", () => {
    expect(sheetEntryState(facts({ seat: 3, round: 2, rounds: ROUND1_LOCKED })).canEnter).toBe(true);
  });

  it("refuses a group event before looking at anything else", () => {
    // Everything else about this call is enterable, so a false here can only be
    // the category check.
    const state = sheetEntryState(facts({ individual: false }));
    expect(state.canEnter).toBe(false);
    expect(state.reason).toContain("group event");
  });

  it("refuses an empty seat", () => {
    const state = sheetEntryState(facts({ seat: null }));
    expect(state.canEnter).toBe(false);
    expect(state.reason).toContain("empty");
  });

  it("keeps round 1 to seat 1 and round 2 off it (N1)", () => {
    expect(sheetEntryState(facts({ seat: 2, round: 1 })).canEnter).toBe(false);
    expect(sheetEntryState(facts({ seat: 1, round: 2, rounds: ROUND1_LOCKED })).canEnter).toBe(
      false
    );
  });

  it("refuses a seat outside the panel rather than assuming a round for it", () => {
    // A seat 5 is a data fault, not a judge with a wider remit.
    expect(sheetEntryState(facts({ seat: 5, round: 2, rounds: ROUND1_LOCKED })).canEnter).toBe(
      false
    );
  });

  it("names the published results before the round that is also shut", () => {
    // Round 1 is locked here too. Naming that first would send the admin to reopen
    // round 1, which is itself refused while the results stand — so the sentence
    // has to be the one obstacle that can actually be cleared first.
    const state = sheetEntryState(facts({ rounds: PUBLISHED }));
    expect(state.canEnter).toBe(false);
    expect(state.reason).toContain("results are published");
  });

  it("refuses round 1 once it is closed, and says to reopen it", () => {
    const state = sheetEntryState(facts({ rounds: ROUND1_LOCKED }));
    expect(state.canEnter).toBe(false);
    expect(state.reason).toContain("Reopen round 1");
  });

  it("refuses round 2 before the qualifiers exist", () => {
    const state = sheetEntryState(facts({ seat: 2, round: 2, rounds: OPEN }));
    expect(state.canEnter).toBe(false);
    expect(state.reason).toContain("Close round 1 first");
  });

  it("refuses a sheet already submitted, since writing one submits it", () => {
    const state = sheetEntryState(facts({ submittedAt: "2026-08-27T02:00:00Z" }));
    expect(state.canEnter).toBe(false);
    expect(state.reason).toContain("Reopen it");
  });
});
