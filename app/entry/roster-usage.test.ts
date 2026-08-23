import { describe, expect, it } from "vitest";

import { eventUsageLabel, participantMetaLabel } from "./roster-usage";

describe("eventUsageLabel", () => {
  it("dashes a participant who is in no entry", () => {
    expect(eventUsageLabel(undefined)).toBe("—");
    expect(eventUsageLabel({ individualCount: 0, groupCount: 0 })).toBe("—");
  });

  it("names only the count that is there", () => {
    expect(eventUsageLabel({ individualCount: 1, groupCount: 0 })).toBe("1 individual");
    expect(eventUsageLabel({ individualCount: 0, groupCount: 2 })).toBe("2 group");
  });

  it("joins both counts when the participant is in each kind", () => {
    expect(eventUsageLabel({ individualCount: 2, groupCount: 1 })).toBe(
      "2 individual · 1 group"
    );
  });
});

describe("participantMetaLabel", () => {
  it("spells out the gender, which has no header to read once folded in", () => {
    expect(participantMetaLabel("F", undefined)).toBe("Female");
    expect(participantMetaLabel("M", undefined)).toBe("Male");
  });

  it("adds the counts the participant actually has", () => {
    expect(participantMetaLabel("F", { individualCount: 1, groupCount: 0 })).toBe(
      "Female · 1 individual"
    );
    expect(participantMetaLabel("M", { individualCount: 2, groupCount: 1 })).toBe(
      "Male · 2 individual · 1 group"
    );
  });

  it("leaves no dangling dash for a participant in no entry", () => {
    expect(participantMetaLabel("M", { individualCount: 0, groupCount: 0 })).toBe("Male");
  });
});
