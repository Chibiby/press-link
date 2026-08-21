import { describe, expect, it } from "vitest";

import { summariseRegistration, type RegistrationEntry } from "./registration-summary";

function person(id: string, number: number | null = null) {
  return { id, name: id, number };
}

function entry(over: Partial<RegistrationEntry> = {}): RegistrationEntry {
  return {
    entryId: "entry-1",
    eventId: "event-1",
    eventName: "News Writing",
    category: "individual",
    level: "secondary",
    language: "english",
    sortOrder: 1,
    submittedAt: "2026-08-01T02:00:00+00:00",
    participants: [person("p1", 101)],
    coaches: [person("c1")],
    ...over,
  };
}

describe("summariseRegistration", () => {
  it("orders by the catalog's sort order, not by submission time", () => {
    const summary = summariseRegistration([
      entry({
        entryId: "b",
        eventName: "Photojournalism",
        sortOrder: 9,
        submittedAt: "2026-07-01T02:00:00+00:00",
      }),
      entry({
        entryId: "a",
        eventName: "News Writing",
        sortOrder: 2,
        submittedAt: "2026-08-01T02:00:00+00:00",
      }),
    ]);
    expect(summary.entries.map((row) => row.eventName)).toEqual([
      "News Writing",
      "Photojournalism",
    ]);
  });

  it("counts a learner entered in two events once", () => {
    const summary = summariseRegistration([
      entry({ entryId: "a", participants: [person("p1", 101), person("p2", 102)] }),
      entry({ entryId: "b", sortOrder: 2, participants: [person("p1", 101)] }),
    ]);
    expect(summary.entryCount).toBe(2);
    expect(summary.learnersEntered).toBe(2);
  });

  it("counts coaches distinctly too", () => {
    const summary = summariseRegistration([
      entry({ entryId: "a", coaches: [person("c1")] }),
      entry({ entryId: "b", sortOrder: 2, coaches: [person("c1"), person("c2")] }),
    ]);
    expect(summary.coachesEntered).toBe(2);
  });

  it("does not reorder its input, and reports zeros for a school with no entries", () => {
    const rows = [entry({ entryId: "b", sortOrder: 9 }), entry({ entryId: "a", sortOrder: 1 })];
    summariseRegistration(rows);
    expect(rows.map((row) => row.entryId)).toEqual(["b", "a"]);

    expect(summariseRegistration([])).toEqual({
      entries: [],
      entryCount: 0,
      learnersEntered: 0,
      coachesEntered: 0,
    });
  });
});
