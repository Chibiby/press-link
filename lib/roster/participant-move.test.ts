import { describe, expect, it } from "vitest";

import {
  eventOptionLabel,
  moveConsequences,
  moveDestinations,
  slotLabel,
  usageExcluding,
  type MoveEventOption,
  type ParticipantEntrySummary,
} from "./participant-move";

function event(id: string, overrides: Partial<MoveEventOption> = {}): MoveEventOption {
  return {
    id,
    name: "News Writing",
    category: "individual",
    level: "elementary",
    language: "english",
    ...overrides,
  };
}

function entry(
  entryId: string,
  overrides: Partial<ParticipantEntrySummary> = {}
): ParticipantEntrySummary {
  return {
    entryId,
    eventId: `ev-${entryId}`,
    eventName: "News Writing",
    category: "individual",
    level: "elementary",
    language: "english",
    teammates: [],
    coachNames: ["Reyes, Juan"],
    minParticipants: 1,
    judged: false,
    ...overrides,
  };
}

describe("slotLabel", () => {
  it("uses the dashboard matrix's own four labels", () => {
    // A dialog that said "Elementary" beside tables that say "Elem" would read as a
    // different level rather than the same one spelled out.
    expect(slotLabel("elementary", "english")).toBe("Elem · Eng");
    expect(slotLabel("secondary", "filipino")).toBe("Sec · Fil");
  });

  it("names an unknown pair rather than returning nothing", () => {
    // Unreachable through the type, but a blank label in a dropdown is an option
    // nobody can pick knowingly.
    expect(slotLabel("elementary", "spanish" as "english")).toContain("elementary");
  });
});

describe("eventOptionLabel", () => {
  it("names the contest, the level and the language in one line", () => {
    expect(eventOptionLabel(event("e1"))).toBe("News Writing · Elem · Eng");
  });
});

describe("usageExcluding", () => {
  it("does not count the entry being moved out of", () => {
    // The rule this exists for: a learner in their second individual event is at the
    // cap, but moving one of those two elsewhere does not make a third.
    const entries = [entry("a"), entry("b", { eventId: "ev-b" })];
    expect(usageExcluding(entries, "a")).toEqual({ individualCount: 1, groupCount: 0 });
  });

  it("splits the count by category", () => {
    const entries = [entry("a"), entry("b", { category: "group", eventId: "ev-b" })];
    expect(usageExcluding(entries, "zzz")).toEqual({ individualCount: 1, groupCount: 1 });
  });
});

describe("moveDestinations", () => {
  const events = [
    event("ev-a"),
    event("ev-b", { name: "Editorial Writing" }),
    event("ev-c", { name: "Radio Broadcasting", category: "group" }),
  ];

  it("drops the entry's own event, which is not a destination", () => {
    const rows = moveDestinations(events, [entry("a")], "a");
    expect(rows.map((row) => row.event.id)).toEqual(["ev-b", "ev-c"]);
  });

  it("marks an event the participant is already entered in rather than hiding it", () => {
    // Greyed out with a reason teaches the admin what they came to find out; absent
    // from the list teaches them nothing.
    const entries = [entry("a"), entry("b", { eventId: "ev-b" })];
    const rows = moveDestinations(events, entries, "a");
    expect(rows.find((row) => row.event.id === "ev-b")?.disabledReason).toBe(
      "Already entered in this event"
    );
  });

  it("marks a destination the participation cap refuses, in the cap's own words", () => {
    const entries = [
      entry("a"),
      entry("b", { eventId: "ev-b" }),
      entry("c", { eventId: "ev-x" }),
    ];
    const rows = moveDestinations(events, entries, "a");
    expect(rows.find((row) => row.event.id === "ev-b")?.disabledReason).toBeTruthy();
    // Two individual entries remain once the source is excluded, which is the cap.
    const group = rows.find((row) => row.event.id === "ev-c");
    expect(group?.disabledReason).toBeNull();
  });

  it("offers every level and language, because schools.level is nullable", () => {
    // It is null for every integrated school — the ones most likely to need a
    // destination at the other level.
    const both = [event("ev-a"), event("ev-b", { level: "secondary" })];
    const rows = moveDestinations(both, [entry("a")], "a");
    expect(rows.map((row) => row.event.id)).toEqual(["ev-b"]);
    expect(rows[0].disabledReason).toBeNull();
  });
});

describe("moveConsequences", () => {
  const base = {
    source: entry("a", { eventName: "News Writing" }),
    destination: event("ev-b", { name: "Editorial Writing" }),
    destinationEntryExists: true,
    destinationJudged: false,
    sourceMemberCount: 2,
    sourceMinParticipants: 1,
  };

  it("says nothing when there is nothing to warn about", () => {
    expect(moveConsequences(base)).toEqual([]);
  });

  it("warns that a solo entry disappears with its last contestant", () => {
    const notes = moveConsequences({ ...base, sourceMemberCount: 1 });
    expect(notes[0]).toContain("will be deleted");
  });

  it("names a team left under its minimum, and says the move will be refused", () => {
    const notes = moveConsequences({
      ...base,
      sourceMemberCount: 7,
      sourceMinParticipants: 7,
    });
    expect(notes[0]).toContain("at least 7");
    expect(notes[0]).toContain("refused");
  });

  it("warns that ranks on the source event will be discarded", () => {
    const notes = moveConsequences({ ...base, source: { ...base.source, judged: true } });
    expect(notes.some((note) => note.includes("discarded"))).toBe(true);
  });

  it("warns that the contestant arrives unranked in a judged destination", () => {
    const notes = moveConsequences({ ...base, destinationJudged: true });
    expect(notes.some((note) => note.includes("unranked"))).toBe(true);
  });

  it("says when an entry will be created for the destination", () => {
    const notes = moveConsequences({ ...base, destinationEntryExists: false });
    expect(notes.some((note) => note.includes("will be created"))).toBe(true);
  });
});
