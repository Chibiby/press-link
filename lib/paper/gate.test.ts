import { describe, expect, it } from "vitest";

import { paperFlowState } from "./gate";

const ANSWERED = "2026-08-14T02:00:00.000Z";
const BEFORE = "2026-08-14T01:00:00.000Z";
const AFTER = "2026-08-14T03:00:00.000Z";

const both = (updatedAt: string) => [
  { language: "english" as const, updatedAt },
  { language: "filipino" as const, updatedAt },
];

describe("paperFlowState", () => {
  it("makes a school with nothing saved fill both languages first", () => {
    const state = paperFlowState({ participation: "undecided", answeredAt: null, papers: [] });
    expect(state.phase).toBe("fill");
    expect(state.paperFormOpen).toBe(true);
    expect(state.rosterEnabled).toBe(false);
    expect(state.askQuestion).toBe(false);
    expect(state.allowNotApplicable).toBe(false);
    expect(state.missingLanguages).toEqual(["english", "filipino"]);
  });

  it("keeps the form open when only one language is saved", () => {
    const state = paperFlowState({
      participation: "undecided",
      answeredAt: null,
      papers: [{ language: "english", updatedAt: BEFORE }],
    });
    expect(state.phase).toBe("fill");
    expect(state.missingLanguages).toEqual(["filipino"]);
    expect(state.rosterEnabled).toBe(false);
  });

  it("asks the question once both languages are saved", () => {
    const state = paperFlowState({
      participation: "undecided",
      answeredAt: null,
      papers: both(BEFORE),
    });
    expect(state.phase).toBe("question");
    expect(state.askQuestion).toBe(true);
    expect(state.paperFormOpen).toBe(false);
    expect(state.rosterEnabled).toBe(false);
  });

  it("locks the papers and opens the roster on yes", () => {
    const state = paperFlowState({
      participation: "yes",
      answeredAt: ANSWERED,
      papers: both(BEFORE),
    });
    expect(state.phase).toBe("done");
    expect(state.paperFormLocked).toBe(true);
    expect(state.rosterEnabled).toBe(true);
    expect(state.askQuestion).toBe(false);
  });

  it("sends a no school back to re-save, with N/A allowed and the roster shut", () => {
    const state = paperFlowState({
      participation: "no",
      answeredAt: ANSWERED,
      papers: both(BEFORE),
    });
    expect(state.phase).toBe("refill");
    expect(state.paperFormOpen).toBe(true);
    expect(state.allowNotApplicable).toBe(true);
    expect(state.rosterEnabled).toBe(false);
    expect(state.paperFormLocked).toBe(false);
  });

  it("still blocks a no school that has re-saved only one language", () => {
    const state = paperFlowState({
      participation: "no",
      answeredAt: ANSWERED,
      papers: [
        { language: "english", updatedAt: AFTER },
        { language: "filipino", updatedAt: BEFORE },
      ],
    });
    expect(state.phase).toBe("refill");
    expect(state.missingLanguages).toEqual(["filipino"]);
    expect(state.rosterEnabled).toBe(false);
  });

  it("releases a no school once both languages are re-saved", () => {
    const state = paperFlowState({
      participation: "no",
      answeredAt: ANSWERED,
      papers: both(AFTER),
    });
    expect(state.phase).toBe("done");
    expect(state.rosterEnabled).toBe(true);
    expect(state.paperFormOpen).toBe(false);
    expect(state.paperFormLocked).toBe(false);
    expect(state.allowNotApplicable).toBe(true);
  });

  it("counts a re-save at the very moment of the answer", () => {
    const state = paperFlowState({
      participation: "no",
      answeredAt: ANSWERED,
      papers: both(ANSWERED),
    });
    expect(state.phase).toBe("done");
  });

  it("treats a missing answer timestamp as nothing re-saved yet", () => {
    const state = paperFlowState({
      participation: "no",
      answeredAt: null,
      papers: both(AFTER),
    });
    expect(state.phase).toBe("refill");
  });
});
