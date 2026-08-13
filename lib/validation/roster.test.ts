import { describe, expect, it } from "vitest";
import {
  paperParticipationSchema,
  rosterCoachSchema,
  rosterParticipantSchema,
} from "./roster";

describe("rosterParticipantSchema", () => {
  it("accepts a participant without a middle name", () => {
    const result = rosterParticipantSchema.safeParse({
      firstName: "Ana",
      lastName: "Dela Cruz",
      gender: "F",
    });
    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const result = rosterParticipantSchema.safeParse({
      firstName: "  Ana  ",
      lastName: "Dela Cruz",
      gender: "F",
    });
    expect(result.success && result.data.firstName).toBe("Ana");
  });

  it("rejects a blank last name", () => {
    const result = rosterParticipantSchema.safeParse({
      firstName: "Ana",
      lastName: "   ",
      gender: "F",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a gender outside M and F", () => {
    const result = rosterParticipantSchema.safeParse({
      firstName: "Ana",
      lastName: "Dela Cruz",
      gender: "X",
    });
    expect(result.success).toBe(false);
  });
});

describe("rosterCoachSchema", () => {
  it("accepts a complete name", () => {
    const result = rosterCoachSchema.safeParse({ fullName: "Mr. Reyes", gender: "M" });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    const result = rosterCoachSchema.safeParse({ fullName: "", gender: "M" });
    expect(result.success).toBe(false);
  });
});

describe("paperParticipationSchema", () => {
  it("accepts yes and no", () => {
    expect(paperParticipationSchema.safeParse("yes").success).toBe(true);
    expect(paperParticipationSchema.safeParse("no").success).toBe(true);
  });

  it("rejects undecided — it is a state, not an answer", () => {
    expect(paperParticipationSchema.safeParse("undecided").success).toBe(false);
  });
});
