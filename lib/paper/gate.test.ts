import { describe, expect, it } from "vitest";

import { paperFlowState } from "./gate";

const both = ["english", "filipino"] as const;

describe("paperFlowState", () => {
  it("makes a school with nothing saved fill both languages first", () => {
    const state = paperFlowState({ participation: "undecided", savedLanguages: [] });
    expect(state.phase).toBe("fill");
    expect(state.paperFormOpen).toBe(true);
    expect(state.askQuestion).toBe(false);
    expect(state.rosterEnabled).toBe(false);
    expect(state.missingLanguages).toEqual(["english", "filipino"]);
  });

  it("keeps the form open when only one language is saved", () => {
    const state = paperFlowState({
      participation: "undecided",
      savedLanguages: ["english"],
    });
    expect(state.phase).toBe("fill");
    expect(state.missingLanguages).toEqual(["filipino"]);
    expect(state.rosterEnabled).toBe(false);
  });

  it("asks the question once both languages are saved", () => {
    const state = paperFlowState({ participation: "undecided", savedLanguages: [...both] });
    expect(state.phase).toBe("question");
    expect(state.askQuestion).toBe(true);
    expect(state.paperFormOpen).toBe(false);
    expect(state.rosterEnabled).toBe(false);
  });

  it("submits the papers and opens the roster on yes", () => {
    const state = paperFlowState({ participation: "yes", savedLanguages: [...both] });
    expect(state.phase).toBe("done");
    expect(state.paperFormLocked).toBe(true);
    expect(state.paperFormOpen).toBe(false);
    expect(state.rosterEnabled).toBe(true);
    expect(state.askQuestion).toBe(false);
  });

  it("asks a school that answered no all over again, roster still shut", () => {
    const state = paperFlowState({ participation: "no", savedLanguages: [...both] });
    expect(state.phase).toBe("question");
    expect(state.askQuestion).toBe(true);
    expect(state.rosterEnabled).toBe(false);
    expect(state.paperFormLocked).toBe(false);
  });

  it("sends a no school back to the form if a paper went missing", () => {
    const state = paperFlowState({ participation: "no", savedLanguages: ["english"] });
    expect(state.phase).toBe("fill");
    expect(state.paperFormOpen).toBe(true);
    expect(state.askQuestion).toBe(false);
  });

  it("never re-asks a yes school, even if a paper is somehow missing", () => {
    const state = paperFlowState({ participation: "yes", savedLanguages: ["english"] });
    expect(state.phase).toBe("done");
    expect(state.rosterEnabled).toBe(true);
    expect(state.askQuestion).toBe(false);
  });

  it("ignores duplicate language rows when counting what is saved", () => {
    const state = paperFlowState({
      participation: "undecided",
      savedLanguages: ["english", "english"],
    });
    expect(state.missingLanguages).toEqual(["filipino"]);
    expect(state.phase).toBe("fill");
  });
});
