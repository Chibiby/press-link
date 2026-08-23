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
  /** Every contestant paired with the same coach — the ordinary small school. */
  const oneCoachFor = (n: number, coachId = "c1") =>
    ids(n).map((participantId) => ({ coachId, participantId }));
  /** A group entry's coaches, who are shared by the team and paired with nobody. */
  const shared = (...coachIds: string[]) =>
    coachIds.map((coachId) => ({ coachId, participantId: null }));

  it("accepts a contestant with their coach", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coaches: oneCoachFor(1),
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBeNull();
  });

  it("accepts one coach covering all three contestants", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(3),
        coaches: oneCoachFor(3),
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBeNull();
  });

  it("accepts a different coach for each contestant", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(3),
        coaches: [
          { coachId: "c1", participantId: "p0" },
          { coachId: "c2", participantId: "p1" },
          { coachId: "c3", participantId: "p2" },
        ],
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
        coaches: oneCoachFor(4),
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
        coaches: shared("c1"),
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
        coaches: shared("c1", "c2"),
        minParticipants: 2,
        maxParticipants: null,
      })
    ).toBeNull();
  });

  it("rejects a contestant left without a coach", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(3),
        coaches: oneCoachFor(2),
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("Choose a coach for every contestant");
  });

  it("rejects a second coach on one contestant", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(2),
        coaches: [
          { coachId: "c1", participantId: "p0" },
          { coachId: "c2", participantId: "p0" },
        ],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("A contestant can have only 1 coach");
  });

  it("rejects an individual entry whose coach is paired with nobody", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coaches: shared("c1"),
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("Choose which contestant each coach is for");
  });

  it("rejects a coach matched to someone off the entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coaches: [{ coachId: "c1", participantId: "someone-else" }],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("A coach was matched to someone who is not in this entry");
  });

  it("rejects an entry with no coach", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coaches: [],
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
        coaches: oneCoachFor(1),
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("The same participant cannot be added twice");
  });

  it("rejects a group coach matched to one member", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(7),
        coaches: [{ coachId: "c1", participantId: "p0" }],
        minParticipants: 7,
        maxParticipants: 7,
      })
    ).toBe("A group entry's coaches are shared by the team, not matched to one member");
  });

  it("rejects the same coach twice on a group entry", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(7),
        coaches: shared("c1", "c1"),
        minParticipants: 7,
        maxParticipants: 7,
      })
    ).toBe("The same coach cannot be added twice");
  });

  it("rejects 3 coaches on a group entry", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(7),
        coaches: shared("c1", "c2", "c3"),
        minParticipants: 7,
        maxParticipants: 7,
      })
    ).toBe("This entry allows at most 2 coaches");
  });
});
