import { describe, expect, it } from "vitest";

import { inferSchoolLevel } from "./level";

describe("inferSchoolLevel", () => {
  it("recognizes a clear elementary name", () => {
    // Same fixture as integrated.test.ts's "leaves ordinary ... schools alone" case.
    expect(inferSchoolLevel("Malapatan Central Elementary School")).toBe("elementary");
  });

  it("recognizes a clear secondary name, phrase form", () => {
    // Same fixture as integrated.test.ts's "leaves ordinary ... schools alone" case.
    expect(inferSchoolLevel("Alabel National High School")).toBe("secondary");
  });

  it("recognizes a secondary name from a trailing acronym", () => {
    expect(inferSchoolLevel("Datal Anggas NHS")).toBe("secondary");
    expect(inferSchoolLevel("Kalaneg HS")).toBe("secondary");
  });

  it("leaves a name that says neither unclassified", () => {
    // "Integrated" schools name their hybrid status, not a level — matches neither
    // pattern, and correctly so: is_integrated is what should be checked for these,
    // not this function.
    expect(inferSchoolLevel("Banlibato Integrated School")).toBeNull();
    // A bare "ES" abbreviation isn't the word "elementary", so it stays unclassified
    // rather than guessed — same fixture as districts-schools.transform.test.ts.
    expect(inferSchoolLevel("Famorcan ES")).toBeNull();
  });

  it("is case-insensitive, because the roll is not consistently cased", () => {
    expect(inferSchoolLevel("MALAPATAN CENTRAL ELEMENTARY SCHOOL")).toBe("elementary");
    expect(inferSchoolLevel("alabel national high school")).toBe("secondary");
    expect(inferSchoolLevel("datal anggas nhs")).toBe("secondary");
  });

  it("classifies as elementary when a name somehow matches both, conservatively", () => {
    expect(inferSchoolLevel("Alabel Elementary and High School Annex")).toBe("elementary");
  });

  it("treats a missing name as unclassified rather than throwing", () => {
    expect(inferSchoolLevel(null)).toBeNull();
    expect(inferSchoolLevel(undefined)).toBeNull();
    expect(inferSchoolLevel("")).toBeNull();
  });
});
