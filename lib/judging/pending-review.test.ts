import { describe, expect, it } from "vitest";

import {
  pendingJudgeReviewCount,
  type PendingRound,
  type PendingSheet,
} from "./pending-review";

const sheet = (
  event_id: string,
  round: number,
  submitted_at: string | null = "2026-09-01T02:00:00Z"
): PendingSheet => ({ event_id, round, submitted_at });

const rounds = (
  event_id: string,
  over: Partial<PendingRound> = {}
): PendingRound => ({
  event_id,
  round1_locked_at: null,
  results_locked_at: null,
  ...over,
});

describe("pendingJudgeReviewCount", () => {
  it("counts an event whose round 1 judge has filed and whose round is still open", () => {
    expect(pendingJudgeReviewCount([sheet("e1", 1)], [])).toBe(1);
  });

  it("ignores a sheet nobody has submitted", () => {
    // A judge cannot save without submitting (N6), so this is a reopened sheet —
    // work the office has already started, not work it has not seen.
    expect(pendingJudgeReviewCount([sheet("e1", 1, null)], [])).toBe(0);
  });

  it("stops counting a round 1 sheet once the round is closed", () => {
    // Closing the round is the act, and it drew its qualifier list from this sheet.
    expect(
      pendingJudgeReviewCount(
        [sheet("e1", 1)],
        [rounds("e1", { round1_locked_at: "2026-09-01T03:00:00Z" })]
      )
    ).toBe(0);
  });

  it("counts a round 2 sheet on an event whose results are not published", () => {
    expect(
      pendingJudgeReviewCount(
        [sheet("e1", 2)],
        [rounds("e1", { round1_locked_at: "2026-09-01T03:00:00Z" })]
      )
    ).toBe(1);
  });

  it("stops counting once the results are published", () => {
    expect(
      pendingJudgeReviewCount(
        [sheet("e1", 1), sheet("e1", 2)],
        [
          rounds("e1", {
            round1_locked_at: "2026-09-01T03:00:00Z",
            results_locked_at: "2026-09-01T04:00:00Z",
          }),
        ]
      )
    ).toBe(0);
  });

  it("counts an event once however many judges have filed on it", () => {
    // Three round 2 judges on one event is one thing for an officer to do, and a
    // badge reading 3 would send them looking for three.
    expect(
      pendingJudgeReviewCount(
        [sheet("e1", 2), sheet("e1", 2), sheet("e1", 2)],
        [rounds("e1", { round1_locked_at: "2026-09-01T03:00:00Z" })]
      )
    ).toBe(1);
  });

  it("treats an event with no event_rounds row as fully open", () => {
    // Nothing has been closed on it at all, which is the most waiting an event can
    // be rather than the least.
    expect(pendingJudgeReviewCount([sheet("e1", 1)], [])).toBe(1);
  });

  it("adds up across events", () => {
    expect(
      pendingJudgeReviewCount(
        [sheet("e1", 1), sheet("e2", 1), sheet("e3", 1)],
        [rounds("e2", { round1_locked_at: "2026-09-01T03:00:00Z" })]
      )
    ).toBe(2);
  });

  it("is nought when nothing has been filed", () => {
    expect(pendingJudgeReviewCount([], [])).toBe(0);
  });
});
