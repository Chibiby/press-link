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

  // Every row on file before migration 0016 is a whole-school paper, and so is
  // every save from a non-integrated school. Input that names no level has to
  // keep meaning exactly that, or 300-odd schools save a level they never chose.
  it("defaults a missing level to whole", () => {
    const result = schoolPaperSchema.safeParse(validInput);
    expect(result.success && result.data.level).toBe("whole");
  });

  it("keeps an explicit level", () => {
    const result = schoolPaperSchema.safeParse({ ...validInput, level: "secondary" });
    expect(result.success && result.data.level).toBe("secondary");
  });

  it("rejects a level that is not one of the three", () => {
    const result = schoolPaperSchema.safeParse({ ...validInput, level: "junior_high" });
    expect(result.success).toBe(false);
  });
});
