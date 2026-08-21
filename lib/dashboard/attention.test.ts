import { describe, expect, it } from "vitest";

import { attentionBadge, buildAttention, type AttentionInput } from "./attention";

const FULL: AttentionInput = {
  learnersWithoutEntry: 114,
  schoolsWithLearnersButNoEntry: 6,
  coachesWithoutEntry: 17,
  schoolsPaperNotStarted: 308,
};

describe("buildAttention", () => {
  it("lists every non-zero category in priority order", () => {
    expect(buildAttention(FULL).map((i) => i.key)).toEqual([
      "learners-no-entry",
      "schools-no-entry",
      "coaches-no-entry",
      "paper-not-started",
    ]);
  });

  it("carries the counts through", () => {
    const byKey = Object.fromEntries(buildAttention(FULL).map((i) => [i.key, i.count]));
    expect(byKey).toEqual({
      "learners-no-entry": 114,
      "schools-no-entry": 6,
      "coaches-no-entry": 17,
      "paper-not-started": 308,
    });
  });

  it("points each item at the filter that reproduces its count", () => {
    const byKey = Object.fromEntries(buildAttention(FULL).map((i) => [i.key, i.href]));
    expect(byKey).toEqual({
      "learners-no-entry": "/admin/participants?unassigned=1",
      "schools-no-entry": "/admin/schools?status=learners-no-entry",
      "coaches-no-entry": "/admin/coaches?unassigned=1",
      "paper-not-started": "/admin/school-papers?status=incomplete",
    });
  });

  it("drops a category with nothing to chase", () => {
    const items = buildAttention({ ...FULL, coachesWithoutEntry: 0 });
    expect(items.map((i) => i.key)).not.toContain("coaches-no-entry");
    expect(items).toHaveLength(3);
  });

  it("returns nothing when the division is fully entered", () => {
    const items = buildAttention({
      learnersWithoutEntry: 0,
      schoolsWithLearnersButNoEntry: 0,
      coachesWithoutEntry: 0,
      schoolsPaperNotStarted: 0,
    });
    expect(items).toEqual([]);
  });

  it("keeps no count inside a label, so nothing needs pluralising", () => {
    for (const item of buildAttention(FULL)) {
      expect(item.label).not.toMatch(/\d/);
    }
  });

  it("treats an unstarted school paper as information, not a warning", () => {
    const tones = Object.fromEntries(buildAttention(FULL).map((i) => [i.key, i.tone]));
    expect(tones["paper-not-started"]).toBe("info");
    expect(tones["learners-no-entry"]).toBe("warn");
  });
});

describe("attentionBadge", () => {
  it("counts categories, not rows", () => {
    expect(attentionBadge(buildAttention(FULL))).toBe(4);
  });

  it("is zero when there is nothing to show", () => {
    expect(attentionBadge([])).toBe(0);
  });
});
