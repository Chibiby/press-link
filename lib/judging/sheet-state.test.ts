import { describe, expect, it } from "vitest";

import {
  EVENT_JUDGING_LABEL,
  eventJudgingStatus,
  judgeSheetState,
  sheetEditable,
} from "./sheet-state";
import type { ConsolidatedBoard, EventRoundState, JudgingRound } from "./types";

const OPEN: EventRoundState = { round1ClosedAt: null, round2CutUsed: null, resultsLockedAt: null };
const ROUND1_CLOSED: EventRoundState = {
  round1ClosedAt: "2026-08-22T01:00:00Z",
  round2CutUsed: 10,
  resultsLockedAt: null,
};
const LOCKED: EventRoundState = {
  round1ClosedAt: "2026-08-22T01:00:00Z",
  round2CutUsed: 10,
  resultsLockedAt: "2026-08-22T03:00:00Z",
};

function boardFor(
  round: JudgingRound,
  options: { judges?: string[]; units?: number; filled?: number; complete?: boolean } = {}
): ConsolidatedBoard {
  const judgeIds = options.judges ?? ["j1"];
  const unitCount = options.units ?? 3;
  const complete = options.complete ?? false;
  let budget = complete ? unitCount * judgeIds.length : (options.filled ?? 0);

  const rows = Array.from({ length: unitCount }, (_, i) => {
    const ranksByJudge: Record<string, number> = {};
    for (const judgeId of judgeIds) {
      if (budget > 0) {
        ranksByJudge[judgeId] = i + 1;
        budget -= 1;
      }
    }
    return {
      unitKey: `u${i}`,
      code: String(i + 1).padStart(4, "0"),
      entryId: `e${i}`,
      participantId: `p${i}`,
      points: complete ? i + 1 : null,
      rank: complete ? i + 1 : null,
      ranksByJudge,
    };
  });

  return { round, rows, judgeIds, complete, missing: complete ? [] : [{ judgeId: judgeIds[0], unitKey: "u0", code: "0001" }] };
}

const EMPTY = (round: JudgingRound): ConsolidatedBoard => ({
  round,
  rows: [],
  judgeIds: [],
  complete: false,
  missing: [],
});

describe("eventJudgingStatus", () => {
  it("reports no panel before it reports no ranks", () => {
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: EMPTY(1),
      round2: EMPTY(2),
    });
    expect(state.status).toBe("not-started");
    expect(state.reason).toContain("No judge is assigned");
  });

  it("reports an event with a panel but no entries", () => {
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: { ...EMPTY(1), judgeIds: ["j1"] },
      round2: EMPTY(2),
    });
    expect(state.status).toBe("not-started");
    expect(state.reason).toContain("no entries");
  });

  it("reports not-started when the panel has filed nothing", () => {
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: boardFor(1, { filled: 0 }),
      round2: EMPTY(2),
    });
    expect(state.status).toBe("not-started");
    expect(state.reason).toContain("No ranks filed");
  });

  it("reports round 1 open with a count once ranking starts", () => {
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: boardFor(1, { judges: ["j1", "j2"], units: 3, filled: 4 }),
      round2: EMPTY(2),
    });
    expect(state.status).toBe("round1-open");
    expect(state.reason).toContain("4 of 6");
  });

  it("separates a finished panel from a closed round", () => {
    // A judge filing their last rank must not close round 1 by accident — closing
    // is what draws the qualifiers, and it is an admin's decision.
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: boardFor(1, { complete: true }),
      round2: EMPTY(2),
    });
    expect(state.status).toBe("round1-awaiting-close");
    expect(state.reason).toContain("Close round 1");
  });

  it("moves to round 2 once round 1 is closed", () => {
    const state = eventJudgingStatus({
      rounds: ROUND1_CLOSED,
      round1: boardFor(1, { complete: true }),
      round2: boardFor(2, { units: 2, filled: 1 }),
    });
    expect(state.status).toBe("round2-open");
    expect(state.reason).toContain("1 of 2");
  });

  it("separates a finished round 2 from locked results", () => {
    const state = eventJudgingStatus({
      rounds: ROUND1_CLOSED,
      round1: boardFor(1, { complete: true }),
      round2: boardFor(2, { complete: true }),
    });
    expect(state.status).toBe("round2-awaiting-lock");
    expect(state.reason).toContain("Lock the results");
  });

  it("reports locked above everything else", () => {
    const state = eventJudgingStatus({
      rounds: LOCKED,
      round1: boardFor(1, { complete: true }),
      round2: boardFor(2, { complete: true }),
    });
    expect(state.status).toBe("locked");
    expect(state.reason).toContain("Unlock");
  });

  it("labels every status", () => {
    for (const label of Object.values(EVENT_JUDGING_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("always gives a reason", () => {
    const cases = [
      { rounds: OPEN, round1: EMPTY(1), round2: EMPTY(2) },
      { rounds: OPEN, round1: boardFor(1, { filled: 1 }), round2: EMPTY(2) },
      { rounds: ROUND1_CLOSED, round1: boardFor(1, { complete: true }), round2: boardFor(2) },
      { rounds: LOCKED, round1: boardFor(1, { complete: true }), round2: boardFor(2, { complete: true }) },
    ];
    for (const input of cases) {
      expect(eventJudgingStatus(input).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("judgeSheetState — assignment is checked first", () => {
  it("tells an unassigned judge nothing about the event", () => {
    // Every other reason leaks something — that the event is open, closed, or
    // locked. This one returns before any of them can.
    for (const rounds of [OPEN, ROUND1_CLOSED, LOCKED]) {
      for (const round of [1, 2] as JudgingRound[]) {
        const state = judgeSheetState({ round, rounds, assigned: false, submittedAt: null });
        expect(state.access).toBe("unavailable");
        expect(state.reason).toBe("You are not assigned to this event.");
      }
    }
  });
});

describe("judgeSheetState — round 1", () => {
  it("is editable before anything is submitted", () => {
    const state = judgeSheetState({ round: 1, rounds: OPEN, assigned: true, submittedAt: null });
    expect(state.access).toBe("edit");
    expect(sheetEditable(state)).toBe(true);
  });

  it("locks on submission", () => {
    // "Once naka rank na i lock lang." A submitted sheet has already fed the
    // board and may already have drawn the qualifiers.
    const state = judgeSheetState({
      round: 1,
      rounds: OPEN,
      assigned: true,
      submittedAt: "2026-08-22T02:00:00Z",
    });
    expect(state.access).toBe("view");
    expect(sheetEditable(state)).toBe(false);
  });

  it("points at the administrator for a change, rather than offering an edit", () => {
    const state = judgeSheetState({
      round: 1,
      rounds: OPEN,
      assigned: true,
      submittedAt: "2026-08-22T02:00:00Z",
    });
    expect(state.reason).toContain("administrator");
  });

  it("is read-only once round 1 closes, even if never submitted", () => {
    const state = judgeSheetState({
      round: 1,
      rounds: ROUND1_CLOSED,
      assigned: true,
      submittedAt: null,
    });
    expect(state.access).toBe("view");
    expect(state.reason).toContain("closed");
  });

  it("is read-only once results are locked", () => {
    const state = judgeSheetState({ round: 1, rounds: LOCKED, assigned: true, submittedAt: null });
    expect(state.access).toBe("view");
  });
});

describe("judgeSheetState — round 2", () => {
  it("is unreachable until round 1 closes", () => {
    // Round 2's unit set does not exist yet: the qualifiers are drawn by closing
    // round 1. An empty sheet would be worse than a closed door.
    const state = judgeSheetState({ round: 2, rounds: OPEN, assigned: true, submittedAt: null });
    expect(state.access).toBe("unavailable");
    expect(state.reason).toContain("round 1");
  });

  it("says round 2 has not opened rather than reporting the lock", () => {
    // Reason ordering: a judge looking at a round that never ran is better served
    // by "it has not opened" than by "results are locked".
    const impossible: EventRoundState = {
      round1ClosedAt: null,
      round2CutUsed: null,
      resultsLockedAt: "2026-08-22T03:00:00Z",
    };
    const state = judgeSheetState({
      round: 2,
      rounds: impossible,
      assigned: true,
      submittedAt: null,
    });
    expect(state.access).toBe("unavailable");
    expect(state.reason).toContain("round 1");
  });

  it("is editable once round 1 is closed", () => {
    const state = judgeSheetState({
      round: 2,
      rounds: ROUND1_CLOSED,
      assigned: true,
      submittedAt: null,
    });
    expect(state.access).toBe("edit");
  });

  it("locks on submission", () => {
    const state = judgeSheetState({
      round: 2,
      rounds: ROUND1_CLOSED,
      assigned: true,
      submittedAt: "2026-08-22T02:30:00Z",
    });
    expect(state.access).toBe("view");
  });

  it("is read-only once results are locked", () => {
    const state = judgeSheetState({ round: 2, rounds: LOCKED, assigned: true, submittedAt: null });
    expect(state.access).toBe("view");
    expect(state.reason).toContain("locked");
  });
});

describe("judgeSheetState — every path explains itself", () => {
  it("never returns a blank reason", () => {
    for (const rounds of [OPEN, ROUND1_CLOSED, LOCKED]) {
      for (const round of [1, 2] as JudgingRound[]) {
        for (const assigned of [true, false]) {
          for (const submittedAt of [null, "2026-08-22T02:00:00Z"]) {
            const state = judgeSheetState({ round, rounds, assigned, submittedAt });
            expect(state.reason.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("only ever grants edit to an assigned judge on an unsubmitted, unclosed sheet", () => {
    for (const rounds of [OPEN, ROUND1_CLOSED, LOCKED]) {
      for (const round of [1, 2] as JudgingRound[]) {
        for (const assigned of [true, false]) {
          for (const submittedAt of [null, "2026-08-22T02:00:00Z"]) {
            const state = judgeSheetState({ round, rounds, assigned, submittedAt });
            if (state.access !== "edit") continue;
            expect(assigned).toBe(true);
            expect(submittedAt).toBeNull();
            expect(rounds.resultsLockedAt).toBeNull();
            if (round === 1) expect(rounds.round1ClosedAt).toBeNull();
            else expect(rounds.round1ClosedAt).not.toBeNull();
          }
        }
      }
    }
  });
});
