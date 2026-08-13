import { describe, expect, it } from "vitest";
import { schoolPaperSchema } from "./school-paper";

const validInput = {
  language: "english" as const,
  paperName: "The Beacon",
  adviserName: "Juan Dela Cruz",
  adviserGender: "M" as const,
  principalName: "Maria Santos",
  staff: [
    { fullName: "Ana Reyes", title: "section_head" as const },
    { fullName: "Ben Cruz", title: "assistant_head" as const },
  ],
};

describe("schoolPaperSchema", () => {
  it("accepts valid input with 2 staff", () => {
    expect(schoolPaperSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects fewer than 2 staff", () => {
    const result = schoolPaperSchema.safeParse({ ...validInput, staff: [validInput.staff[0]] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty paper name", () => {
    const result = schoolPaperSchema.safeParse({ ...validInput, paperName: "  " });
    expect(result.success).toBe(false);
  });
});
