import { describe, expect, it } from "vitest";
import {
  paperAnswerSchema,
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

describe("paperAnswerSchema", () => {
  it("accepts a plain yes", () => {
    expect(paperAnswerSchema.safeParse({ choice: "yes" }).success).toBe(true);
  });

  it("requires a reason with a no", () => {
    const result = paperAnswerSchema.safeParse({ choice: "no" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Please choose a reason");
  });

  it("accepts a no with a listed reason", () => {
    expect(
      paperAnswerSchema.safeParse({ choice: "no", reason: "no_paper_yet" }).success
    ).toBe(true);
  });

  it("requires a note when the reason is other", () => {
    const result = paperAnswerSchema.safeParse({ choice: "no", reason: "other" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Please describe your reason");
  });

  it("rejects a whitespace-only note", () => {
    expect(
      paperAnswerSchema.safeParse({ choice: "no", reason: "other", note: "   " }).success
    ).toBe(false);
  });

  it("accepts other with a real note", () => {
    expect(
      paperAnswerSchema.safeParse({
        choice: "no",
        reason: "other",
        note: "Adviser is on leave",
      }).success
    ).toBe(true);
  });
});
