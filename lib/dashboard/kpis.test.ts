import { describe, expect, it } from "vitest";

import { buildKpis, type KpiInput } from "./kpis";

// The figures measured in production on 2026-08-19, so the test fails loudly if
// a subtitle ever starts reading as though the whole division had competed.
const LIVE: KpiInput = {
  schoolsRegistered: 332,
  schoolsWithEntries: 16,
  participants: 383,
  participantsWithoutEntry: 114,
  coaches: 83,
  coachesWithoutEntry: 17,
  entries: 130,
  entriesIndividual: 96,
  entriesGroup: 34,
  eventTypes: 16,
  eventTypesContested: 12,
  districtsRegistered: 23,
  districtsWithEntries: 10,
};

describe("buildKpis", () => {
  it("returns the six tiles in the order the comp lays them out", () => {
    expect(buildKpis(LIVE).map((k) => k.key)).toEqual([
      "schools",
      "learners",
      "coaches",
      "entries",
      "events",
      "districts",
    ]);
  });

  it("headlines participation, not registration, for schools", () => {
    const schools = buildKpis(LIVE).find((k) => k.key === "schools");
    expect(schools).toMatchObject({
      label: "Registered Schools",
      value: 16,
      subtitle: "of 332 registered",
    });
  });

  it("says how many learners have not entered rather than implying all have", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "learners")).toMatchObject({
      label: "Learners",
      value: 383,
      subtitle: "114 not yet entered",
    });
  });

  it("does the same for coaches", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "coaches")).toMatchObject({
      label: "Coaches",
      value: 83,
      subtitle: "17 not yet entered",
    });
  });

  it("splits entries by category in the subtitle", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "entries")).toMatchObject({
      label: "Total Entries",
      value: 130,
      subtitle: "96 individual / 34 group",
    });
  });

  it("headlines contested event types against the catalogue size", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "events")).toMatchObject({
      label: "Events",
      value: 12,
      subtitle: "of 16 types",
    });
  });

  it("headlines participating districts against the registered count", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "districts")).toMatchObject({
      label: "Districts",
      value: 10,
      subtitle: "of 23 registered",
    });
  });

  it("survives an empty division without dividing by anything", () => {
    const empty: KpiInput = {
      schoolsRegistered: 0,
      schoolsWithEntries: 0,
      participants: 0,
      participantsWithoutEntry: 0,
      coaches: 0,
      coachesWithoutEntry: 0,
      entries: 0,
      entriesIndividual: 0,
      entriesGroup: 0,
      eventTypes: 0,
      eventTypesContested: 0,
      districtsRegistered: 0,
      districtsWithEntries: 0,
    };
    const tiles = buildKpis(empty);
    expect(tiles).toHaveLength(6);
    expect(tiles.every((t) => t.value === 0)).toBe(true);
    expect(tiles.every((t) => t.subtitle.length > 0)).toBe(true);
  });
});
