import { describe, expect, it } from "vitest";

import { bulkCutPlan, bulkCutSummary } from "./bulk-cut";
import type { EventIndexRow } from "./event-index";
import type { EventJudgingStatus } from "./types";

/**
 * Only the fields `bulkCutPlan` reads. Cast rather than built whole: an
 * `EventIndexRow` carries two consolidated boards and a standings array, and a
 * fixture that built them would be testing `buildEventIndex` instead.
 */
function row(
  eventId: string,
  over: {
    status?: EventJudgingStatus;
    scored?: number;
    cut?: number | null;
    qualifiers?: number;
    round2Ranked?: boolean;
    individual?: boolean;
    judgeId?: string | null;
  } = {}
): EventIndexRow {
  const {
    status = "round1-awaiting-close",
    scored = 20,
    cut = 15,
    qualifiers = 0,
    round2Ranked = false,
    individual = true,
    judgeId = "j1",
  } = over;

  return {
    eventId,
    typeNameEn: "News Writing",
    slotLabel: "Elem · Eng",
    state: { status, reason: "" },
    round2Cut: cut,
    round1Cut: individual ? { round: 1, judgeId, rows: [], scored } : null,
    round2: {
      round: 2,
      rows: Array.from({ length: qualifiers }, (_, i) => ({
        unitKey: `u${i}`,
        code: `000${i}`,
        entryId: `e${i}`,
        participantId: `u${i}`,
        points: null,
        rank: null,
        ranksByJudge: round2Ranked ? { j2: 1 } : {},
      })),
      judgeIds: [],
      complete: false,
      missing: [],
    },
  } as unknown as EventIndexRow;
}

describe("bulkCutPlan", () => {
  it("raises a cut standing below what the judge ranked", () => {
    const plan = bulkCutPlan([row("e1", { scored: 20, cut: 15 })]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ from: 15, to: 20, wasLocked: false });
  });

  it("leaves alone a cut that is merely larger than the field ranked", () => {
    // A cut of 30 over 20 ranked already lets all twenty through. Setting it to 20
    // would record a tidier number, change nothing about who competes, and cost a
    // reopen on a closed round.
    const plan = bulkCutPlan([row("e1", { scored: 20, cut: 30 })]);
    expect(plan.steps).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("reads a closed round from its qualifier list, not from the live column", () => {
    // An event locked under an old cut of 15 has fifteen qualifiers however large
    // events.round2_cut has grown since. Reading the column would report it fixed.
    const plan = bulkCutPlan([
      row("e1", { status: "round2-open", scored: 20, cut: 30, qualifiers: 15 }),
    ]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ to: 20, qualifiers: 15, wasLocked: true });
  });

  it("leaves a closed round alone when its list already holds everyone ranked", () => {
    const plan = bulkCutPlan([
      row("e1", { status: "round2-open", scored: 17, cut: 30, qualifiers: 17 }),
    ]);
    expect(plan.steps).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("counts a tie through the cut as everyone being through", () => {
    // A cut of 30 with a three-way tie for 30th sends 32, which is more than the
    // 31 ranked. Nobody was kept out, so there is nothing to raise.
    const plan = bulkCutPlan([
      row("e1", { status: "round2-open", scored: 31, cut: 30, qualifiers: 32 }),
    ]);
    expect(plan.steps).toEqual([]);
  });

  it("refuses an event whose results are published", () => {
    const plan = bulkCutPlan([
      row("e1", { status: "locked", scored: 20, cut: 15, qualifiers: 15 }),
    ]);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped[0].reason).toContain("results are published");
  });

  it("refuses an event whose round 2 has been ranked", () => {
    // Reopening round 1 discards every round 2 sheet (N8). That is not this
    // feature's to spend.
    const plan = bulkCutPlan([
      row("e1", {
        status: "round2-open",
        scored: 20,
        cut: 15,
        qualifiers: 15,
        round2Ranked: true,
      }),
    ]);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped[0].reason).toContain("discards every round 2 sheet");
  });

  it("refuses a field ranked past the largest cut an event may carry", () => {
    const plan = bulkCutPlan([row("e1", { scored: 51, cut: 30 })]);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped[0].reason).toContain("50");
  });

  it("passes over an unranked event without listing it", () => {
    // Most of the catalog is unranked most of the time, and a skipped list of
    // thirty "nobody has ranked this" lines buries the events this is about.
    const plan = bulkCutPlan([row("e1", { scored: 0, judgeId: null })]);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("leaves group events out entirely", () => {
    const plan = bulkCutPlan([row("e1", { individual: false })]);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.unchanged).toBe(0);
  });

  it("carries the seat 1 judge, whose sheet has to be re-submitted", () => {
    const plan = bulkCutPlan([row("e1", { judgeId: "judge-7" })]);
    expect(plan.steps[0].judgeId).toBe("judge-7");
  });
});

describe("bulkCutSummary", () => {
  it("always reports what it left alone, since that is most of the catalog", () => {
    expect(bulkCutSummary({ changed: 2, failed: 0, unchanged: 36 })).toBe(
      "2 cuts raised, 36 already let everyone ranked through."
    );
  });

  it("counts a refusal separately", () => {
    expect(bulkCutSummary({ changed: 1, failed: 1, unchanged: 4 })).toBe(
      "1 cut raised, 1 refused, 4 already let everyone ranked through."
    );
  });
});
