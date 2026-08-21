import { describe, expect, it } from "vitest";

import { isPaperLevel, levelBelongsTo, levelsForSchool, paperSlots } from "./level";

describe("levelsForSchool", () => {
  it("gives an integrated school two levels, in elementary-then-secondary order", () => {
    expect(levelsForSchool(true)).toEqual(["elementary", "secondary"]);
  });

  it("leaves every other school with the single paper it already had", () => {
    expect(levelsForSchool(false)).toEqual(["whole"]);
  });

  it("returns a fresh array, so a caller sorting it cannot reorder the constant", () => {
    const levels = levelsForSchool(true);
    levels.reverse();
    expect(levelsForSchool(true)).toEqual(["elementary", "secondary"]);
  });
});

describe("levelBelongsTo", () => {
  it("accepts the levelled rows an integrated school owns", () => {
    expect(levelBelongsTo("elementary", true)).toBe(true);
    expect(levelBelongsTo("secondary", true)).toBe(true);
  });

  it("rejects a whole-school row on an integrated school", () => {
    // Reachable only if a school is flipped to integrated after it filed a
    // paper. The row is then stale, not authoritative, and read paths drop it.
    expect(levelBelongsTo("whole", true)).toBe(false);
  });

  it("accepts only the whole-school row on an ordinary school", () => {
    expect(levelBelongsTo("whole", false)).toBe(true);
    expect(levelBelongsTo("elementary", false)).toBe(false);
    expect(levelBelongsTo("secondary", false)).toBe(false);
  });
});

describe("isPaperLevel", () => {
  it("accepts the three real values", () => {
    for (const value of ["whole", "elementary", "secondary"]) {
      expect(isPaperLevel(value)).toBe(true);
    }
  });

  it("rejects junk, so a hand-edited URL or payload falls back rather than filtering to nothing", () => {
    expect(isPaperLevel("primary")).toBe(false);
    expect(isPaperLevel("")).toBe(false);
    expect(isPaperLevel(null)).toBe(false);
    expect(isPaperLevel(undefined)).toBe(false);
  });
});

describe("paperSlots", () => {
  it("gives an ordinary school its two languages, unchanged", () => {
    expect(paperSlots(false, [{ language: "english", level: "whole" }])).toEqual([
      { language: "english", level: "whole", filled: true },
      { language: "filipino", level: "whole", filled: false },
    ]);
  });

  it("gives an integrated school four slots, language-major", () => {
    const slots = paperSlots(true, []);
    expect(slots.map((s) => `${s.language}:${s.level}`)).toEqual([
      "english:elementary",
      "english:secondary",
      "filipino:elementary",
      "filipino:secondary",
    ]);
    expect(slots.every((s) => !s.filled)).toBe(true);
  });

  it("marks only the levels actually on file", () => {
    const slots = paperSlots(true, [
      { language: "english", level: "elementary" },
      { language: "filipino", level: "secondary" },
    ]);
    expect(slots.filter((s) => s.filled).map((s) => `${s.language}:${s.level}`)).toEqual([
      "english:elementary",
      "filipino:secondary",
    ]);
  });

  it("ignores a stored row whose level contradicts its school", () => {
    // A school reclassified as integrated after filing a whole-school paper.
    // That row is stale: the school can no longer see or edit it, so counting
    // it would report an elementary paper nobody wrote.
    const slots = paperSlots(true, [{ language: "english", level: "whole" }]);
    expect(slots.every((s) => !s.filled)).toBe(true);
  });
});
