import { describe, expect, it } from "vitest";
import { entrySchema } from "./entry";

const EVENT = "123e4567-e89b-12d3-a456-426614174000";
const P1 = "223e4567-e89b-12d3-a456-426614174001";
const P2 = "323e4567-e89b-12d3-a456-426614174002";
const C1 = "423e4567-e89b-12d3-a456-426614174003";

describe("entrySchema", () => {
  it("accepts an entry referencing roster ids", () => {
    const result = entrySchema.safeParse({
      eventId: EVENT,
      participantIds: [P1, P2],
      coachIds: [C1],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an entry with no participants", () => {
    const result = entrySchema.safeParse({
      eventId: EVENT,
      participantIds: [],
      coachIds: [C1],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entry with no coaches", () => {
    const result = entrySchema.safeParse({
      eventId: EVENT,
      participantIds: [P1],
      coachIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a typed name where an id belongs", () => {
    const result = entrySchema.safeParse({
      eventId: EVENT,
      participantIds: ["Ana Dela Cruz"],
      coachIds: [C1],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid event id", () => {
    const result = entrySchema.safeParse({
      eventId: "news-writing",
      participantIds: [P1],
      coachIds: [C1],
    });
    expect(result.success).toBe(false);
  });
});
