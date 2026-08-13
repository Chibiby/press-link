import { describe, expect, it } from "vitest";
import { entrySchema } from "./entry";

const baseCoach = { fullName: "Coach One", gender: "M" as const };
const participant = (n: string) => ({ firstName: n, lastName: "Dela Cruz", gender: "F" as const });

describe("entrySchema", () => {
  it("accepts an individual entry with exactly 1 participant", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "individual",
      participants: [participant("Ana")],
      coaches: [baseCoach],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an individual entry with 2 participants", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "individual",
      participants: [participant("Ana"), participant("Ben")],
      coaches: [baseCoach],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a group entry with fewer than 2 participants", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "group",
      participants: [participant("Ana")],
      coaches: [baseCoach],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a group entry with 5 participants", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "group",
      participants: ["Ana", "Ben", "Cathy", "Dan", "Eve"].map(participant),
      coaches: [baseCoach],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 2 coaches", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "individual",
      participants: [participant("Ana")],
      coaches: [baseCoach, baseCoach, baseCoach],
    });
    expect(result.success).toBe(false);
  });
});
