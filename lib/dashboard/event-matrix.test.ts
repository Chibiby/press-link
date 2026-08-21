import { describe, expect, it } from "vitest";

import {
  buildEventMatrix,
  slotKey,
  teamSize,
  type EventMatrixInput,
} from "./event-matrix";

function slot(over: Partial<EventMatrixInput> = {}): EventMatrixInput {
  return {
    eventId: "e1",
    typeId: "news",
    typeNameEn: "News Writing",
    typeNameFil: "Pagsulat ng Balita",
    category: "individual",
    minParticipants: 1,
    maxParticipants: 3,
    sortOrder: 1,
    level: "elementary",
    language: "english",
    entries: 0,
    ...over,
  };
}

/** News Writing at all four slots, MOJO at secondary only, one group type. */
const ROWS: EventMatrixInput[] = [
  slot({ eventId: "n-ee", level: "elementary", language: "english", entries: 4 }),
  slot({ eventId: "n-ef", level: "elementary", language: "filipino", entries: 2 }),
  slot({ eventId: "n-se", level: "secondary", language: "english", entries: 5 }),
  slot({ eventId: "n-sf", level: "secondary", language: "filipino", entries: 1 }),
  slot({
    eventId: "m-se",
    typeId: "mojo",
    typeNameEn: "MOJO",
    typeNameFil: "MOJO",
    sortOrder: 10,
    level: "secondary",
    language: "english",
    entries: 0,
  }),
  slot({
    eventId: "m-sf",
    typeId: "mojo",
    typeNameEn: "MOJO",
    typeNameFil: "MOJO",
    sortOrder: 10,
    level: "secondary",
    language: "filipino",
    entries: 0,
  }),
  slot({
    eventId: "r-se",
    typeId: "radio",
    typeNameEn: "Radio Broadcasting",
    typeNameFil: "Radio Broadcasting",
    category: "group",
    minParticipants: 7,
    maxParticipants: 7,
    sortOrder: 11,
    level: "secondary",
    language: "english",
    entries: 3,
  }),
];

describe("buildEventMatrix", () => {
  it("splits types by category and keeps each in event_types sort order", () => {
    const matrix = buildEventMatrix([...ROWS].reverse());
    expect(matrix.individual.map((row) => row.typeId)).toEqual(["news", "mojo"]);
    expect(matrix.group.map((row) => row.typeId)).toEqual(["radio"]);
  });

  it("fills the four slots and counts how many are offered", () => {
    const matrix = buildEventMatrix(ROWS);
    const news = matrix.individual[0];
    expect(news.offered).toBe(4);
    expect(news.slots["elementary-english"]).toEqual({ eventId: "n-ee", entries: 4 });
    expect(news.entries).toBe(12);
  });

  it("leaves a slot null when no such contest exists, so the page can print a dash", () => {
    // MOJO is secondary-only. `0` here would read as "nobody entered"; null reads as
    // "there is nothing to enter", and those are different facts.
    const matrix = buildEventMatrix(ROWS);
    const mojo = matrix.individual[1];
    expect(mojo.slots["elementary-english"]).toBeNull();
    expect(mojo.slots["elementary-filipino"]).toBeNull();
    expect(mojo.slots["secondary-english"]).toEqual({ eventId: "m-se", entries: 0 });
    expect(mojo.offered).toBe(2);
  });

  it("counts contested types the way the dashboard KPI does", () => {
    // The Events KPI is "types with >= 1 entry of N types". MOJO has two events and no
    // entries, so it is offered but not contested.
    const matrix = buildEventMatrix(ROWS);
    expect(matrix.typesTotal).toBe(3);
    expect(matrix.typesWithEntries).toBe(2);
    expect(matrix.eventsTotal).toBe(7);
    expect(matrix.entriesTotal).toBe(15);
  });

  it("reports zeros for an empty catalog rather than throwing", () => {
    expect(buildEventMatrix([])).toEqual({
      individual: [],
      group: [],
      typesTotal: 0,
      typesWithEntries: 0,
      eventsTotal: 0,
      entriesTotal: 0,
    });
  });

  it("keeps an offered-but-unentered slot distinct from an unoffered one", () => {
    // The page renders these two differently and must never be able to confuse them:
    // an existing event with no entries prints `0`, an absent event prints an em dash.
    // Both of MOJO's elementary slots are absent; both of its secondary slots exist
    // and are empty. `null` vs `{ entries: 0 }` is the only signal carrying that.
    const matrix = buildEventMatrix(ROWS);
    const mojo = matrix.individual[1];

    expect(mojo.slots["secondary-english"]).not.toBeNull();
    expect(mojo.slots["secondary-english"]?.entries).toBe(0);
    expect(mojo.slots["secondary-filipino"]).not.toBeNull();
    expect(mojo.slots["secondary-filipino"]?.entries).toBe(0);

    // A zero-entry slot still counts as offered; only the absent ones do not.
    expect(mojo.offered).toBe(2);
    // And a type whose every offered slot is empty is offered but not contested.
    expect(mojo.entries).toBe(0);
  });
});

describe("slotKey", () => {
  it("builds the four keys", () => {
    expect(slotKey("elementary", "english")).toBe("elementary-english");
    expect(slotKey("secondary", "filipino")).toBe("secondary-filipino");
  });
});

describe("teamSize", () => {
  it("prints a fixed size once, not as a range", () => {
    expect(teamSize({ minParticipants: 7, maxParticipants: 7 })).toBe("7");
  });

  it("prints a range with an en dash", () => {
    expect(teamSize({ minParticipants: 1, maxParticipants: 3 })).toBe("1–3");
  });

  it("prints an open upper bound in words", () => {
    // Online Publishing is min 2, max null in the catalog.
    expect(teamSize({ minParticipants: 2, maxParticipants: null })).toBe("2 or more");
  });
});
