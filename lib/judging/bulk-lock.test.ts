import { describe, expect, it } from "vitest";

import {
  bulkLockPlan,
  bulkLockScope,
  bulkLockSummary,
  BULK_LOCK_SCOPES,
} from "./bulk-lock";
import type { EventIndexRow } from "./event-index";
import type { EventJudgingStatus } from "./types";

/**
 * Only the five fields `bulkLockPlan` reads. Cast rather than built whole: an
 * `EventIndexRow` carries two consolidated boards and a standings array, none of
 * which this module looks at, and a fixture that built them would be testing
 * `buildEventIndex` instead.
 */
function row(
  eventId: string,
  status: EventJudgingStatus,
  over: { round2Cut?: number | null; individual?: boolean; typeNameEn?: string } = {}
): EventIndexRow {
  const { round2Cut = 10, individual = true, typeNameEn = "News Writing" } = over;
  return {
    eventId,
    typeNameEn,
    slotLabel: "Elem · Eng",
    state: { status, reason: "" },
    round2Cut,
    round1Cut: individual ? { round: 1, judgeId: null, rows: [], scored: 0 } : null,
  } as unknown as EventIndexRow;
}

const ROUND1_READY = "round1-awaiting-close" as const;
const RESULTS_READY = "round2-awaiting-lock" as const;

describe("BULK_LOCK_SCOPES", () => {
  it("offers the two group scopes and refuses them, rather than leaving them out", () => {
    // Leaving them off the list would answer the question by pretending nobody
    // asked it. The same choice eventControls makes when it renders all five
    // controls for a group event and disables every one.
    const group = BULK_LOCK_SCOPES.filter((scope) => scope.id.endsWith("-group"));
    expect(group).toHaveLength(2);
    for (const scope of group) {
      expect(scope.controls).toEqual([]);
      expect(scope.detail).toContain("Not available");
    }
  });

  it("names round 2's lock as the publication it is", () => {
    expect(bulkLockScope("results-individual")?.controls).toEqual(["lock-results"]);
  });

  it("returns null for an id nobody offers", () => {
    expect(bulkLockScope("everything")).toBeNull();
  });
});

describe("bulkLockPlan", () => {
  it("queues every event whose round 1 is ready to close", () => {
    const plan = bulkLockPlan(
      [row("e1", ROUND1_READY), row("e2", ROUND1_READY)],
      bulkLockScope("round1-individual")!
    );
    expect(plan.steps.map((step) => step.eventId)).toEqual(["e1", "e2"]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips an event with the control's own sentence, not a summary of its own", () => {
    // "Round 1's judge has not submitted a sheet yet" is the thing an admin can
    // act on. "Not eligible" is not.
    const plan = bulkLockPlan([row("e1", "round1-open")], bulkLockScope("round1-individual")!);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped[0].reason).toContain("has not submitted");
  });

  it("skips a group event, saying it is a group event", () => {
    const plan = bulkLockPlan(
      [row("e1", ROUND1_READY, { individual: false })],
      bulkLockScope("round1-individual")!
    );
    expect(plan.skipped[0].reason).toContain("group event");
  });

  it("skips an event with no cut on file rather than drawing an empty field", () => {
    const plan = bulkLockPlan(
      [row("e1", ROUND1_READY, { round2Cut: null })],
      bulkLockScope("round1-individual")!
    );
    expect(plan.skipped[0].reason).toContain("no round 2 cut");
  });

  it("publishes only where round 2 is complete", () => {
    const plan = bulkLockPlan(
      [row("e1", RESULTS_READY), row("e2", "round2-open")],
      bulkLockScope("results-individual")!
    );
    expect(plan.steps.map((step) => step.eventId)).toEqual(["e1"]);
    expect(plan.skipped[0].reason).toContain("Round 2 is not complete");
  });

  it("takes an event one step at a time under the combined scope", () => {
    // Closing round 1 opens a round nobody has ranked. Queueing lock-results
    // behind it would queue a publication of standings that do not exist yet, and
    // the RPC would refuse it a second later.
    const plan = bulkLockPlan([row("e1", ROUND1_READY)], bulkLockScope("both-individual")!);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].control).toBe("lock-round1");
  });

  it("reaches the second control when the first is not available", () => {
    const plan = bulkLockPlan([row("e1", RESULTS_READY)], bulkLockScope("both-individual")!);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].control).toBe("lock-results");
  });

  it("reports the first refusal when neither control can run", () => {
    const plan = bulkLockPlan([row("e1", "locked")], bulkLockScope("both-individual")!);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped[0].reason).toContain("already closed");
  });

  it("refuses a group scope outright, whatever the catalog holds", () => {
    const plan = bulkLockPlan(
      [row("e1", ROUND1_READY), row("e2", ROUND1_READY, { individual: false })],
      bulkLockScope("round1-group")!
    );
    expect(plan.steps).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.unavailable).toContain("Not available");
  });

  it("names an event the way every judging table names it", () => {
    const plan = bulkLockPlan([row("e1", ROUND1_READY)], bulkLockScope("round1-individual")!);
    expect(plan.steps[0].eventName).toBe("News Writing · Elem · Eng");
  });
});

describe("bulkLockSummary", () => {
  it("counts a refusal separately from a skip", () => {
    // A skip was decided before anything was attempted and is the ordinary case. A
    // failure is an event the plan believed was ready and the database refused.
    expect(bulkLockSummary({ locked: 12, failed: 1, skipped: 27 })).toBe(
      "12 events locked, 1 refused, 27 not ready."
    );
  });

  it("says nothing about failures or skips when there were none", () => {
    expect(bulkLockSummary({ locked: 1, failed: 0, skipped: 0 })).toBe("1 event locked.");
  });

  it("still reports a run that locked nothing", () => {
    expect(bulkLockSummary({ locked: 0, failed: 0, skipped: 40 })).toBe(
      "0 events locked, 40 not ready."
    );
  });
});
