import { describe, expect, it } from "vitest";

import { isIntegratedName } from "./integrated";

describe("isIntegratedName", () => {
  it("matches the real integrated schools on the division roll", () => {
    // Both names are taken from scripts/seed/districts-schools.transform.test.ts,
    // which carries rows copied from the division's own workbook.
    expect(isIntegratedName("Banlibato Integrated School")).toBe(true);
    expect(isIntegratedName("Alabel Integrated SPED Center")).toBe(true);
  });

  it("is case-insensitive, because the roll is not consistently cased", () => {
    expect(isIntegratedName("BANLIBATO INTEGRATED SCHOOL")).toBe(true);
    expect(isIntegratedName("banlibato integrated school")).toBe(true);
  });

  it("leaves ordinary elementary and secondary schools alone", () => {
    expect(isIntegratedName("Alabel National High School")).toBe(false);
    expect(isIntegratedName("Malapatan Central Elementary School")).toBe(false);
  });

  it("requires a whole word, so a substring match cannot promote a school", () => {
    // The reason this is `\b...\b` and not `%integrated%`: a bare substring test
    // would make this school integrated and give it two papers per language it
    // never asked for.
    expect(isIntegratedName("Reintegrated Learners Center")).toBe(false);
    expect(isIntegratedName("Disintegrated Annex")).toBe(false);
  });

  it("treats a missing name as not integrated rather than throwing", () => {
    expect(isIntegratedName(null)).toBe(false);
    expect(isIntegratedName(undefined)).toBe(false);
    expect(isIntegratedName("")).toBe(false);
  });
});
