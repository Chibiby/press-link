import { describe, expect, it } from "vitest";
import {
  capReason,
  formatParticipantNumber,
  maxCoachesFor,
  validateEntryCounts,
} from "./limits";

describe("formatParticipantNumber", () => {
  it("pads to four digits", () => {
    expect(formatParticipantNumber(1)).toBe("0001");
    expect(formatParticipantNumber(42)).toBe("0042");
    expect(formatParticipantNumber(9999)).toBe("9999");
  });
});

describe("capReason", () => {
  it("returns null for a participant with no history", () => {
    expect(capReason(undefined, "individual")).toBeNull();
    expect(capReason(undefined, "group")).toBeNull();
  });

  it("allows a second individual event but not a third", () => {
    expect(capReason({ individualCount: 1, groupCount: 0 }, "individual")).toBeNull();
    expect(capReason({ individualCount: 2, groupCount: 0 }, "individual")).toBe(
      "Already in 2 individual events"
    );
  });

  it("allows only one group event", () => {
    expect(capReason({ individualCount: 0, groupCount: 0 }, "group")).toBeNull();
    expect(capReason({ individualCount: 0, groupCount: 1 }, "group")).toBe(
      "Already in a group event"
    );
  });

  it("counts the two categories independently", () => {
    expect(capReason({ individualCount: 2, groupCount: 0 }, "group")).toBeNull();
    expect(capReason({ individualCount: 0, groupCount: 1 }, "individual")).toBeNull();
  });
});

describe("maxCoachesFor", () => {
  it("caps individual coaches at 3", () => {
    expect(maxCoachesFor("individual")).toBe(3);
  });

  it("caps group coaches at 2 regardless of team size", () => {
    expect(maxCoachesFor("group")).toBe(2);
  });
});

describe("validateEntryCounts", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

  it("accepts a 1-participant 1-coach individual entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coachIds: ["c1"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBeNull();
  });

  it("rejects a 4th participant in an individual entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(4),
        coachIds: ["c1"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("This event allows at most 3 participants");
  });

  it("rejects a 6-member team for a 7-member contest", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(6),
        coachIds: ["c1"],
        minParticipants: 7,
        maxParticipants: 7,
      })
    ).toBe("This event requires at least 7 participants");
  });

  it("accepts an unbounded group above its minimum", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(9),
        coachIds: ["c1"],
        minParticipants: 2,
        maxParticipants: null,
      })
    ).toBeNull();
  });

  it("accepts 3 coaches on a 1-participant individual entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coachIds: ["c1", "c2", "c3"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBeNull();
  });

  it("rejects 4 coaches on an individual entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coachIds: ["c1", "c2", "c3", "c4"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("This entry allows at most 3 coaches");
  });

  it("rejects 3 coaches on a group entry", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(7),
        coachIds: ["c1", "c2", "c3"],
        minParticipants: 7,
        maxParticipants: 7,
      })
    ).toBe("This entry allows at most 2 coaches");
  });

  it("rejects an entry with no coach", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coachIds: [],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("At least 1 coach is required");
  });

  it("rejects the same participant twice in one entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ["p1", "p1"],
        coachIds: ["c1"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("The same participant cannot be added twice");
  });

  it("rejects the same coach twice in one entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ["p1", "p2"],
        coachIds: ["c1", "c1"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("The same coach cannot be added twice");
  });
});
