import { describe, expect, it } from "vitest";

import {
  EVENT_JUDGING_LABEL,
  eventJudgingStatus,
  judgeSheetState,
  ROUND1_SEAT,
  ROUND2_SEATS,
  sheetEditable,
  type Round1JudgingView,
} from "./sheet-state";
import type { ConsolidatedBoard, EventRoundState, JudgingRound } from "./types";

/**
 * The two rounds are not the same shape (N1), and these tests exist mostly to hold
 * that asymmetry: round 1 is one judge in seat 1 cutting the field, round 2 is the
 * other three seats placing the qualifiers. A seat is therefore not a label on an
 * assignment — it decides which round a judge may reach at all.
 *
 * The other fact under test is that the gate is `round1_locked_at`, not
 * `round1_closed_at` (N6). They move together on a normal lock, so only the N8
 * fixture below tells them apart.
 */

const OPEN: EventRoundState = {
  round1ClosedAt: null,
  round1LockedAt: null,
  round2CutUsed: null,
  resultsLockedAt: null,
};

const ROUND1_LOCKED: EventRoundState = {
  round1ClosedAt: "2026-08-22T01:00:00Z",
  round1LockedAt: "2026-08-22T01:00:00Z",
  round2CutUsed: 10,
  resultsLockedAt: null,
};

/**
 * Round 1 unlocked in the middle of round 2 (N8).
 *
 * `admin_unlock_round1` clears the lock and leaves the close where it was, so this
 * is the one state where the two timestamps disagree — and the only fixture that
 * can catch a branch reading the wrong one.
 */
const ROUND1_UNLOCKED: EventRoundState = {
  round1ClosedAt: "2026-08-22T01:00:00Z",
  round1LockedAt: null,
  round2CutUsed: 10,
  resultsLockedAt: null,
};

const LOCKED: EventRoundState = {
  round1ClosedAt: "2026-08-22T01:00:00Z",
  round1LockedAt: "2026-08-22T01:00:00Z",
  round2CutUsed: 10,
  resultsLockedAt: "2026-08-22T03:00:00Z",
};

const ALL_ROUNDS = [OPEN, ROUND1_LOCKED, ROUND1_UNLOCKED, LOCKED];

/**
 * Round 1 as one judge's sheet: `[code, rank]` pairs, with null for a blank.
 *
 * `complete` is passed separately from the ranks because the two are independent
 * under N2 — a cut leaves most rows deliberately blank, so a full sheet and a
 * submitted sheet are different things.
 */
function round1View(
  entries: [code: string, rank: number | null][],
  options: { judges?: string[]; complete?: boolean } = {}
): Round1JudgingView {
  return {
    rows: entries.map(([code, rank], i) => ({
      unitKey: `u${i}`,
      code,
      entryId: `e${i}`,
      participantId: `p${i}`,
      rank,
    })),
    judgeIds: options.judges ?? ["seat-1"],
    complete: options.complete ?? false,
  };
}

/** A sheet of `count` contestants with nothing typed. */
function unranked(count: number): Round1JudgingView {
  return round1View(
    Array.from({ length: count }, (_, i) => [String(i + 1).padStart(4, "0"), null])
  );
}

/** A sheet ranking the first `filled` of `count` contestants, the rest blank. */
function partlyRanked(count: number, filled: number, complete = false): Round1JudgingView {
  return round1View(
    Array.from({ length: count }, (_, i) => [
      String(i + 1).padStart(4, "0"),
      i < filled ? i + 1 : null,
    ]),
    { complete }
  );
}

const NO_JUDGE: Round1JudgingView = { rows: [], judgeIds: [], complete: false };

function boardFor(
  round: JudgingRound,
  options: { judges?: string[]; units?: number; filled?: number; complete?: boolean } = {}
): ConsolidatedBoard {
  const judgeIds = options.judges ?? ["j2", "j3", "j4"];
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

  return {
    round,
    rows,
    judgeIds,
    complete,
    missing: complete ? [] : [{ judgeId: judgeIds[0], unitKey: "u0", code: "0001" }],
  };
}

const EMPTY = (round: JudgingRound): ConsolidatedBoard => ({
  round,
  rows: [],
  judgeIds: [],
  complete: false,
  missing: [],
});

describe("eventJudgingStatus — round 1", () => {
  it("reports no judge before it reports no ranks", () => {
    const state = eventJudgingStatus({ rounds: OPEN, round1: NO_JUDGE, round2: EMPTY(2) });
    expect(state.status).toBe("not-started");
    expect(state.reason).toContain("No judge is assigned");
  });

  it("reports an event with a judge but no entries", () => {
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: { ...NO_JUDGE, judgeIds: ["seat-1"] },
      round2: EMPTY(2),
    });
    expect(state.status).toBe("not-started");
    expect(state.reason).toContain("no entries");
  });

  it("reports not-started while the sheet is untouched", () => {
    const state = eventJudgingStatus({ rounds: OPEN, round1: unranked(5), round2: EMPTY(2) });
    expect(state.status).toBe("not-started");
    expect(state.reason).toContain("not filed any ranks");
  });

  it("reports round 1 open with a count once ranking starts", () => {
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: partlyRanked(5, 2),
      round2: EMPTY(2),
    });
    expect(state.status).toBe("round1-open");
    expect(state.reason).toContain("2 of 5");
  });

  it("counts typed ranks, not blanks — the count is not a progress bar (N2)", () => {
    // A cut of ten over twelve contestants is a *finished* sheet with two blanks.
    // The count is there to tell an admin something is happening, and it must not
    // be read as "two ranks outstanding": the judge is done at the cut.
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: partlyRanked(12, 10),
      round2: EMPTY(2),
    });
    expect(state.reason).toContain("10 of 12");
  });

  it("separates a submitted judge from a locked round", () => {
    // A judge filing their last rank must not lock round 1 by accident — locking
    // is what draws the qualifiers, and it is an admin's decision.
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: partlyRanked(12, 10, true),
      round2: EMPTY(2),
    });
    expect(state.status).toBe("round1-awaiting-close");
    expect(state.reason).toContain("Lock round 1");
  });

  it("takes submission from the sheet, not from a full sheet", () => {
    // The same twelve rows with ten ranks, submitted and not. Nothing about the
    // rows separates these two states, which is why `complete` is a fact about
    // the sheet (N6) rather than a count of rows.
    const rows = partlyRanked(12, 10).rows;
    const open = eventJudgingStatus({
      rounds: OPEN,
      round1: { rows, judgeIds: ["seat-1"], complete: false },
      round2: EMPTY(2),
    });
    const submitted = eventJudgingStatus({
      rounds: OPEN,
      round1: { rows, judgeIds: ["seat-1"], complete: true },
      round2: EMPTY(2),
    });
    expect(open.status).toBe("round1-open");
    expect(submitted.status).toBe("round1-awaiting-close");
  });

  it("accepts a consolidated board as round 1, for a group event (non-negotiable 6)", () => {
    // The admin event index still passes a panel board here for group events, whose
    // model this feature does not touch. The view is structural so it fits.
    const state = eventJudgingStatus({
      rounds: OPEN,
      round1: boardFor(1, { judges: ["j1"], complete: true }),
      round2: EMPTY(2),
    });
    expect(state.status).toBe("round1-awaiting-close");
  });
});

describe("eventJudgingStatus — the lock is the gate (N6, N8)", () => {
  it("moves to round 2 once round 1 is locked", () => {
    const state = eventJudgingStatus({
      rounds: ROUND1_LOCKED,
      round1: partlyRanked(12, 10, true),
      round2: boardFor(2, { units: 2, filled: 4 }),
    });
    expect(state.status).toBe("round2-open");
    expect(state.reason).toContain("4 of 6");
    expect(state.reason).toContain("1 of 3 judges");
  });

  it("goes back to round 1 when the lock is lifted mid-round-2", () => {
    // N8. The close is still set, so a branch reading `round1ClosedAt` would keep
    // reporting round 2 — over a round 1 that is open for editing again and a
    // qualifier set that may be about to change.
    const state = eventJudgingStatus({
      rounds: ROUND1_UNLOCKED,
      round1: partlyRanked(12, 10, true),
      round2: boardFor(2, { units: 2, complete: true }),
    });
    expect(state.status).toBe("round1-awaiting-close");
  });

  it("separates a finished round 2 from locked results", () => {
    const state = eventJudgingStatus({
      rounds: ROUND1_LOCKED,
      round1: partlyRanked(12, 10, true),
      round2: boardFor(2, { complete: true }),
    });
    expect(state.status).toBe("round2-awaiting-lock");
    expect(state.reason).toContain("Lock the results");
  });

  it("reports locked above everything else", () => {
    const state = eventJudgingStatus({
      rounds: LOCKED,
      round1: partlyRanked(12, 10, true),
      round2: boardFor(2, { complete: true }),
    });
    expect(state.status).toBe("locked");
    expect(state.reason).toContain("Unlock");
  });
});

describe("eventJudgingStatus — every path explains itself", () => {
  it("labels every status", () => {
    for (const label of Object.values(EVENT_JUDGING_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("always gives a reason", () => {
    const round1s = [NO_JUDGE, unranked(3), partlyRanked(3, 1), partlyRanked(3, 3, true)];
    const round2s = [EMPTY(2), boardFor(2, { filled: 1 }), boardFor(2, { complete: true })];
    for (const rounds of ALL_ROUNDS) {
      for (const round1 of round1s) {
        for (const round2 of round2s) {
          expect(eventJudgingStatus({ rounds, round1, round2 }).reason.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("judgeSheetState — assignment is checked first", () => {
  it("tells an unassigned judge nothing about the event", () => {
    // Every other reason leaks something — that the event is open, locked, or that
    // this judge's seat is on the other round. This one returns before any of them.
    for (const rounds of ALL_ROUNDS) {
      for (const round of [1, 2] as JudgingRound[]) {
        for (const seat of [null, 1, 2, 4]) {
          const state = judgeSheetState({ round, rounds, assigned: false, seat, submittedAt: null });
          expect(state.access).toBe("unavailable");
          expect(state.reason).toBe("You are not assigned to this event.");
        }
      }
    }
  });
});

describe("judgeSheetState — the seat decides the round (N1)", () => {
  it("refuses round 1 to every seat but the first", () => {
    for (const seat of [2, 3, 4]) {
      const state = judgeSheetState({
        round: 1,
        rounds: OPEN,
        assigned: true,
        seat,
        submittedAt: null,
      });
      expect(state.access).toBe("unavailable");
      expect(state.reason).toContain("not your seat");
    }
  });

  it("refuses round 1 to an assigned judge holding no seat", () => {
    // A seatless assignment is a data fault, and the safe reading of it is no
    // access rather than access to the round that decides who competes at all.
    const state = judgeSheetState({
      round: 1,
      rounds: OPEN,
      assigned: true,
      seat: null,
      submittedAt: null,
    });
    expect(state.access).toBe("unavailable");
  });

  it("refuses round 2 to the judge who made the cut", () => {
    const state = judgeSheetState({
      round: 2,
      rounds: ROUND1_LOCKED,
      assigned: true,
      seat: 1,
      submittedAt: null,
    });
    expect(state.access).toBe("unavailable");
    expect(state.reason).toContain("other three judges");
  });

  it("refuses round 2 to a judge holding no seat, or a seat off the panel", () => {
    // The panel is four seats and there is no fifth (N1), which
    // `admin_assign_judge` enforces. A row that got past it — a seatless
    // assignment, or a seat from a wider panel — is a data fault, and round 2 is
    // the round that places the winners.
    for (const seat of [null, 5, 0]) {
      const state = judgeSheetState({
        round: 2,
        rounds: ROUND1_LOCKED,
        assigned: true,
        seat,
        submittedAt: null,
      });
      expect(state.access).toBe("unavailable");
      expect(state.reason).toContain("no seat");
    }
  });

  it("names round 1 to the judge who made the cut, rather than saying they hold no seat", () => {
    // Seat 1 is a legitimate seat on this event, so the generic refusal would be
    // both true and useless. The reason has to say why round 2 is closed to them.
    const state = judgeSheetState({
      round: 2,
      rounds: ROUND1_LOCKED,
      assigned: true,
      seat: 1,
      submittedAt: null,
    });
    expect(state.reason).toContain("You ranked round 1");
  });

  it("keeps the two seat rules in step with the constants they name", () => {
    expect(ROUND1_SEAT).toBe(1);
    expect([...ROUND2_SEATS]).toEqual([2, 3, 4]);
    expect(ROUND2_SEATS).not.toContain(ROUND1_SEAT);
  });

  it("refuses on the seat before it reports any fact about the round", () => {
    // The ordering test. Results are locked here and round 1 with it, but a judge
    // on the wrong round must not learn that from the refusal — the reason names
    // the seat, and nothing else.
    const wrongRound1 = judgeSheetState({
      round: 1,
      rounds: LOCKED,
      assigned: true,
      seat: 3,
      submittedAt: "2026-08-22T02:00:00Z",
    });
    expect(wrongRound1.reason).toContain("not your seat");
    expect(wrongRound1.reason).not.toContain("locked");

    const wrongRound2 = judgeSheetState({
      round: 2,
      rounds: LOCKED,
      assigned: true,
      seat: 1,
      submittedAt: "2026-08-22T02:00:00Z",
    });
    expect(wrongRound2.reason).toContain("other three judges");
    expect(wrongRound2.reason).not.toContain("locked");
  });
});

describe("judgeSheetState — round 1", () => {
  const seat1 = (rounds: EventRoundState, submittedAt: string | null = null) =>
    judgeSheetState({ round: 1, rounds, assigned: true, seat: 1, submittedAt });

  it("is editable before anything is submitted", () => {
    const state = seat1(OPEN);
    expect(state.access).toBe("edit");
    expect(sheetEditable(state)).toBe(true);
  });

  it("locks on submission", () => {
    // "Once naka rank na i lock lang." A submitted sheet has already fed the
    // board and may already have drawn the qualifiers.
    const state = seat1(OPEN, "2026-08-22T02:00:00Z");
    expect(state.access).toBe("view");
    expect(sheetEditable(state)).toBe(false);
  });

  it("points at the administrator for a change, rather than offering an edit", () => {
    expect(seat1(OPEN, "2026-08-22T02:00:00Z").reason).toContain("administrator");
  });

  it("is read-only once round 1 is locked, even if never submitted", () => {
    const state = seat1(ROUND1_LOCKED);
    expect(state.access).toBe("view");
    expect(state.reason).toContain("Round 1 is locked");
  });

  it("becomes editable again when an admin lifts the lock (N8)", () => {
    // The whole point of `admin_unlock_round1`: a mistake in the cut is corrected
    // by the judge who made it, part-way through round 2. The close is still set,
    // so a branch reading `round1ClosedAt` would hold the sheet shut and leave the
    // unlock with nothing to do.
    const state = seat1(ROUND1_UNLOCKED);
    expect(state.access).toBe("edit");
    expect(sheetEditable(state)).toBe(true);
  });

  it("is read-only once results are locked", () => {
    expect(seat1(LOCKED).access).toBe("view");
  });
});

describe("judgeSheetState — round 2", () => {
  const seat2 = (rounds: EventRoundState, submittedAt: string | null = null) =>
    judgeSheetState({ round: 2, rounds, assigned: true, seat: 2, submittedAt });

  it("is unreachable until round 1 is locked", () => {
    // Round 2's unit set does not exist yet: the qualifiers are drawn by locking
    // round 1. An empty sheet would be worse than a closed door.
    const state = seat2(OPEN);
    expect(state.access).toBe("unavailable");
    expect(state.reason).toContain("round 1 is locked");
  });

  it("closes again if round 1 is unlocked mid-round-2 (N8)", () => {
    // The qualifier set is what round 2 ranks, and an unlocked round 1 can change
    // it. Withdrawing the sheet is better than taking ranks against a field that
    // is about to be redrawn.
    expect(seat2(ROUND1_UNLOCKED).access).toBe("unavailable");
  });

  it("says round 2 has not opened rather than reporting the lock", () => {
    // Reason ordering: a judge looking at a round that never ran is better served
    // by "it has not opened" than by "results are locked".
    const impossible: EventRoundState = {
      round1ClosedAt: null,
      round1LockedAt: null,
      round2CutUsed: null,
      resultsLockedAt: "2026-08-22T03:00:00Z",
    };
    const state = seat2(impossible);
    expect(state.access).toBe("unavailable");
    expect(state.reason).toContain("round 1");
  });

  it("is editable once round 1 is locked", () => {
    expect(seat2(ROUND1_LOCKED).access).toBe("edit");
  });

  it("is editable for each of the three seats that place the qualifiers", () => {
    for (const seat of [2, 3, 4]) {
      const state = judgeSheetState({
        round: 2,
        rounds: ROUND1_LOCKED,
        assigned: true,
        seat,
        submittedAt: null,
      });
      expect(state.access).toBe("edit");
    }
  });

  it("locks on submission", () => {
    expect(seat2(ROUND1_LOCKED, "2026-08-22T02:30:00Z").access).toBe("view");
  });

  it("is read-only once results are locked", () => {
    const state = seat2(LOCKED);
    expect(state.access).toBe("view");
    expect(state.reason).toContain("locked");
  });
});

describe("judgeSheetState — every path explains itself", () => {
  const cases = () => {
    const out: Parameters<typeof judgeSheetState>[0][] = [];
    for (const rounds of ALL_ROUNDS) {
      for (const round of [1, 2] as JudgingRound[]) {
        for (const assigned of [true, false]) {
          for (const seat of [null, 1, 2, 4]) {
            for (const submittedAt of [null, "2026-08-22T02:00:00Z"]) {
              out.push({ round, rounds, assigned, seat, submittedAt });
            }
          }
        }
      }
    }
    return out;
  };

  it("never returns a blank reason", () => {
    for (const input of cases()) {
      expect(judgeSheetState(input).reason.length).toBeGreaterThan(0);
    }
  });

  it("only ever grants edit on the seat's own round, unsubmitted, with the lock in the right state", () => {
    for (const input of cases()) {
      const state = judgeSheetState(input);
      if (state.access !== "edit") continue;
      expect(input.assigned).toBe(true);
      expect(input.submittedAt).toBeNull();
      expect(input.rounds.resultsLockedAt).toBeNull();
      if (input.round === 1) {
        expect(input.seat).toBe(1);
        // The lock, not the close: `ROUND1_UNLOCKED` reaches here with a close set.
        expect(input.rounds.round1LockedAt).toBeNull();
      } else {
        expect(input.seat).not.toBe(1);
        expect(input.seat).not.toBeNull();
        expect(input.rounds.round1LockedAt).not.toBeNull();
      }
    }
  });

  it("grants edit somewhere, so the assertion above is not vacuous", () => {
    expect(cases().filter((input) => judgeSheetState(input).access === "edit").length).toBeGreaterThan(0);
  });
});
