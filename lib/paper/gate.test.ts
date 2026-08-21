import { describe, expect, it } from "vitest";

import type { EventLanguage } from "@/lib/events-catalog";

import { paperFlowState } from "./gate";

/** Papers for an ordinary school: one per language, all `whole`. */
const whole = (...langs: EventLanguage[]) =>
  langs.map((language) => ({ language, level: "whole" as const }));

const both = ["english", "filipino"] as const;

describe("paperFlowState", () => {
  it("forces the form open when no language is saved", () => {
    const state = paperFlowState({
      participation: "undecided",
      savedPapers: [],
      isIntegrated: false,
      lockedAt: null,
      entryCount: 1,
    });
    expect(state.phase).toBe("fill");
    expect(state.paperFormOpen).toBe(true);
    expect(state.askQuestion).toBe(false);
    expect(state.rosterEnabled).toBe(false);
    expect(state.savedLanguages).toEqual([]);
  });

  it("treats one saved language as enough to reach the question", () => {
    const state = paperFlowState({
      participation: "undecided",
      savedPapers: whole("filipino"),
      isIntegrated: false,
      lockedAt: null,
      entryCount: 1,
    });
    expect(state.phase).toBe("question");
    expect(state.paperFormOpen).toBe(false);
    expect(state.askQuestion).toBe(true);
    expect(state.rosterEnabled).toBe(false);
    expect(state.savedLanguages).toEqual(["filipino"]);
  });

  it("opens the roster on yes", () => {
    const state = paperFlowState({
      participation: "yes",
      savedPapers: whole(...both),
      isIntegrated: false,
      lockedAt: null,
      entryCount: 1,
    });
    expect(state.phase).toBe("done");
    expect(state.rosterEnabled).toBe(true);
    expect(state.askQuestion).toBe(false);
    expect(state.submissionLocked).toBe(false);
  });

  it("opens the roster on no as well, and keeps the papers editable", () => {
    const state = paperFlowState({
      participation: "no",
      savedPapers: whole("english"),
      isIntegrated: false,
      lockedAt: null,
      entryCount: 1,
    });
    expect(state.phase).toBe("done");
    expect(state.rosterEnabled).toBe(true);
    expect(state.askQuestion).toBe(false);
    expect(state.submissionLocked).toBe(false);
    expect(state.canAnswer).toBe(true);
  });

  it("freezes the papers and the answer once the school locks in", () => {
    const state = paperFlowState({
      participation: "no",
      savedPapers: whole(...both),
      isIntegrated: false,
      lockedAt: "2026-08-14T02:00:00.000Z",
      entryCount: 1,
    });
    expect(state.submissionLocked).toBe(true);
    expect(state.canAnswer).toBe(false);
    expect(state.canLock).toBe(false);
    expect(state.rosterEnabled).toBe(true);
  });

  it("offers the lock only once the question has been answered", () => {
    expect(
      paperFlowState({
        participation: "undecided",
        savedPapers: whole("english"),
        isIntegrated: false,
        lockedAt: null,
        entryCount: 1,
      }).canLock
    ).toBe(false);
    expect(
      paperFlowState({
        participation: "yes",
        savedPapers: whole("english"),
        isIntegrated: false,
        lockedAt: null,
        entryCount: 1,
      }).canLock
    ).toBe(true);
  });

  it("sends an answered school back to the form if every paper went missing", () => {
    const state = paperFlowState({
      participation: "yes",
      savedPapers: [],
      isIntegrated: false,
      lockedAt: null,
      entryCount: 1,
    });
    expect(state.phase).toBe("fill");
    expect(state.paperFormOpen).toBe(true);
    expect(state.rosterEnabled).toBe(false);
  });

  it("keeps a locked school out of the form even with no paper rows", () => {
    const state = paperFlowState({
      participation: "yes",
      savedPapers: [],
      isIntegrated: false,
      lockedAt: "2026-08-14T02:00:00.000Z",
      entryCount: 1,
    });
    expect(state.paperFormOpen).toBe(false);
    expect(state.submissionLocked).toBe(true);
    expect(state.rosterEnabled).toBe(true);
  });

  it("dedupes and orders saved languages", () => {
    const state = paperFlowState({
      participation: "no",
      savedPapers: whole("filipino", "english", "filipino"),
      isIntegrated: false,
      lockedAt: null,
      entryCount: 1,
    });
    expect(state.savedLanguages).toEqual(["english", "filipino"]);
  });

  it("refuses the lock until the school has an entry", () => {
    const state = paperFlowState({
      participation: "yes",
      savedPapers: whole("english"),
      isIntegrated: false,
      lockedAt: null,
      entryCount: 0,
    });
    expect(state.canLock).toBe(false);
    expect(state.rosterEnabled).toBe(true);
  });

  it("offers the lock once an entry exists", () => {
    const state = paperFlowState({
      participation: "yes",
      savedPapers: whole("english"),
      isIntegrated: false,
      lockedAt: null,
      entryCount: 1,
    });
    expect(state.canLock).toBe(true);
  });
});

/**
 * An integrated school clears stage 1 only when it has a paper at BOTH levels.
 * Language does not matter for the gate — one elementary paper and one
 * secondary paper, in whichever languages the school publishes, is the bar.
 */
describe("paperFlowState — integrated schools", () => {
  const elem = { language: "english" as const, level: "elementary" as const };
  const sec = { language: "filipino" as const, level: "secondary" as const };

  it("holds an integrated school at the form until both levels exist", () => {
    const state = paperFlowState({
      participation: "yes",
      savedPapers: [elem],
      isIntegrated: true,
      lockedAt: null,
      entryCount: 3,
    });
    // One language is NOT enough here, which is the whole difference.
    expect(state.phase).toBe("fill");
    expect(state.paperFormOpen).toBe(true);
    expect(state.rosterEnabled).toBe(false);
    expect(state.missingLevels).toEqual(["secondary"]);
  });

  it("clears the gate on one elementary and one secondary, in any languages", () => {
    const state = paperFlowState({
      participation: "yes",
      savedPapers: [elem, sec],
      isIntegrated: true,
      lockedAt: null,
      entryCount: 3,
    });
    expect(state.phase).toBe("done");
    expect(state.rosterEnabled).toBe(true);
    expect(state.missingLevels).toEqual([]);
    // Both languages appear because each level was filed in a different one.
    expect(state.savedLanguages).toEqual(["english", "filipino"]);
  });

  it("does not accept two papers at the same level as covering both", () => {
    const state = paperFlowState({
      participation: "yes",
      savedPapers: [elem, { language: "filipino" as const, level: "elementary" as const }],
      isIntegrated: true,
      lockedAt: null,
      entryCount: 3,
    });
    expect(state.phase).toBe("fill");
    expect(state.missingLevels).toEqual(["secondary"]);
  });

  it("ignores a stale whole-school paper on an integrated school", () => {
    // Left behind by a school reclassified after filing. It belongs to no level
    // this school owes, so it cannot stand in for either one.
    const state = paperFlowState({
      participation: "yes",
      savedPapers: [{ language: "english" as const, level: "whole" as const }],
      isIntegrated: true,
      lockedAt: null,
      entryCount: 3,
    });
    expect(state.phase).toBe("fill");
    expect(state.missingLevels).toEqual(["elementary", "secondary"]);
    expect(state.savedLanguages).toEqual([]);
  });

  it("still asks the contest question once both levels are in", () => {
    const state = paperFlowState({
      participation: "undecided",
      savedPapers: [elem, sec],
      isIntegrated: true,
      lockedAt: null,
      entryCount: 0,
    });
    expect(state.phase).toBe("question");
    expect(state.askQuestion).toBe(true);
    expect(state.rosterEnabled).toBe(false);
  });

  it("leaves a locked integrated school alone, papers or not", () => {
    // A locked school cannot re-file, so gating it on levels it can never add
    // would strand it. Locking still wins over everything.
    const state = paperFlowState({
      participation: "yes",
      savedPapers: [],
      isIntegrated: true,
      lockedAt: "2026-08-14T02:00:00.000Z",
      entryCount: 3,
    });
    expect(state.phase).toBe("done");
    expect(state.submissionLocked).toBe(true);
    expect(state.rosterEnabled).toBe(true);
    expect(state.missingLevels).toEqual([]);
  });

  it("reports the single whole-school level for an ordinary school", () => {
    expect(
      paperFlowState({
        participation: "undecided",
        savedPapers: [],
        isIntegrated: false,
        lockedAt: null,
        entryCount: 0,
      }).missingLevels
    ).toEqual(["whole"]);
  });
});
