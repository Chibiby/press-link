import { describe, expect, it } from "vitest";

import { paperFlowState } from "./gate";

const both = ["english", "filipino"] as const;

describe("paperFlowState", () => {
  it("forces the form open when no language is saved", () => {
    const state = paperFlowState({
      participation: "undecided",
      savedLanguages: [],
      lockedAt: null,
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
      savedLanguages: ["filipino"],
      lockedAt: null,
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
      savedLanguages: [...both],
      lockedAt: null,
    });
    expect(state.phase).toBe("done");
    expect(state.rosterEnabled).toBe(true);
    expect(state.askQuestion).toBe(false);
    expect(state.paperFormLocked).toBe(false);
  });

  it("opens the roster on no as well, and keeps the papers editable", () => {
    const state = paperFlowState({
      participation: "no",
      savedLanguages: ["english"],
      lockedAt: null,
    });
    expect(state.phase).toBe("done");
    expect(state.rosterEnabled).toBe(true);
    expect(state.askQuestion).toBe(false);
    expect(state.paperFormLocked).toBe(false);
    expect(state.canAnswer).toBe(true);
  });

  it("freezes the papers and the answer once the school locks in", () => {
    const state = paperFlowState({
      participation: "no",
      savedLanguages: [...both],
      lockedAt: "2026-08-14T02:00:00.000Z",
    });
    expect(state.paperFormLocked).toBe(true);
    expect(state.canAnswer).toBe(false);
    expect(state.canLock).toBe(false);
    expect(state.rosterEnabled).toBe(true);
  });

  it("offers the lock only once the question has been answered", () => {
    expect(
      paperFlowState({ participation: "undecided", savedLanguages: ["english"], lockedAt: null })
        .canLock
    ).toBe(false);
    expect(
      paperFlowState({ participation: "yes", savedLanguages: ["english"], lockedAt: null }).canLock
    ).toBe(true);
  });

  it("sends an answered school back to the form if every paper went missing", () => {
    const state = paperFlowState({
      participation: "yes",
      savedLanguages: [],
      lockedAt: null,
    });
    expect(state.phase).toBe("fill");
    expect(state.paperFormOpen).toBe(true);
    expect(state.rosterEnabled).toBe(false);
  });

  it("keeps a locked school out of the form even with no paper rows", () => {
    const state = paperFlowState({
      participation: "yes",
      savedLanguages: [],
      lockedAt: "2026-08-14T02:00:00.000Z",
    });
    expect(state.paperFormOpen).toBe(false);
    expect(state.paperFormLocked).toBe(true);
    expect(state.rosterEnabled).toBe(true);
  });

  it("dedupes and orders saved languages", () => {
    const state = paperFlowState({
      participation: "no",
      savedLanguages: ["filipino", "english", "filipino"],
      lockedAt: null,
    });
    expect(state.savedLanguages).toEqual(["english", "filipino"]);
  });
});
