import { describe, expect, it } from "vitest";

import {
  buildEventIndex,
  eventIndexSummary,
  eventSlotLabel,
  NO_JUDGING_FACTS,
  type EventJudgingFacts,
  type RawIndexEvent,
} from "./event-index";
import type { ContestUnit, JudgeRank } from "./types";

function event(
  eventId: string,
  overrides: Partial<RawIndexEvent> = {}
): RawIndexEvent {
  return {
    eventId,
    typeNameEn: "News Writing",
    typeNameFil: "Pagsulat ng Balita",
    category: "individual",
    level: "elementary",
    language: "english",
    sortOrder: 1,
    entries: 0,
    ...overrides,
  };
}

function unit(code: string, key = `u-${code}`): ContestUnit {
  return { unitKey: key, code, entryId: `e-${code}`, participantId: key };
}

function sheet(judgeId: string, places: Record<string, number>): JudgeRank[] {
  return Object.entries(places).map(([unitKey, rank]) => ({ judgeId, unitKey, rank }));
}

function facts(overrides: Partial<EventJudgingFacts> = {}): EventJudgingFacts {
  return {
    judgeIds: [],
    units: [],
    round1Ranks: [],
    round2Units: [],
    round2Ranks: [],
    rounds: { round1ClosedAt: null, round2CutUsed: null, resultsLockedAt: null },
    round2Cut: null,
    ...overrides,
  };
}

const A = unit("0001", "a");
const B = unit("0002", "b");

describe("eventSlotLabel", () => {
  it("uses the label the events matrix already prints", () => {
    // Written down once, in EVENT_SLOTS. If this test starts failing because the
    // matrix was reworded, the adjudication pages have already followed it — which
    // is the point.
    expect(eventSlotLabel("elementary", "english")).toBe("Elem · Eng");
    expect(eventSlotLabel("elementary", "filipino")).toBe("Elem · Fil");
    expect(eventSlotLabel("secondary", "english")).toBe("Sec · Eng");
    expect(eventSlotLabel("secondary", "filipino")).toBe("Sec · Fil");
  });
});

describe("buildEventIndex with no facts", () => {
  // This is the state the placeholder pages render, so it is tested as a state and
  // not as a stub: the status below is produced by the real eventJudgingStatus over
  // a real empty panel, and it will be produced the same way once migration 0018
  // exists.
  const rows = buildEventIndex([event("e1", { entries: 4 })]);

  it("reports an unseated panel rather than a started one", () => {
    expect(rows[0].panelSize).toBe(0);
    expect(rows[0].state.status).toBe("not-started");
    expect(rows[0].state.reason).toBe("No judge is assigned to this event yet.");
  });

  it("marks both boards not ranked, with no judges to consolidate over", () => {
    expect(rows[0].round1.complete).toBe(false);
    expect(rows[0].round2.complete).toBe(false);
    expect(rows[0].round1.judgeIds).toEqual([]);
    expect(rows[0].round1.rows).toEqual([]);
  });

  it("leaves the round 2 cut null rather than defaulting it", () => {
    // 10 is what the RPC will apply if nobody chooses; it is not a choice the
    // division has made, and a page must not print it as one.
    expect(rows[0].round2Cut).toBeNull();
  });

  it("still carries the real entry count, which does not depend on judging", () => {
    expect(rows[0].entries).toBe(4);
  });
});

describe("buildEventIndex with facts", () => {
  it("consolidates a finished round 1 and asks the admin to close it", () => {
    const rows = buildEventIndex([event("e1", { entries: 2 })], {
      e1: facts({
        judgeIds: ["j1"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round2Cut: 10,
      }),
    });

    expect(rows[0].panelSize).toBe(1);
    expect(rows[0].round1.complete).toBe(true);
    expect(rows[0].state.status).toBe("round1-awaiting-close");
    expect(rows[0].round2Cut).toBe(10);
  });

  it("reports a partly-filed round 1 as open, quoting progress", () => {
    const rows = buildEventIndex([event("e1")], {
      e1: facts({
        judgeIds: ["j1", "j2"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
      }),
    });

    expect(rows[0].state.status).toBe("round1-open");
    expect(rows[0].state.reason).toContain("2 of 4 ranks filed");
    // Non-negotiable 4: no row is ranked while a judge is outstanding, not even the
    // rows the finished judge has already placed.
    expect(rows[0].round1.rows.every((row) => row.rank === null)).toBe(true);
  });

  it("keeps one event's panel out of another's", () => {
    // The facts map is partial by design. An event with no entry in it must fall
    // back to an empty panel and not inherit the panel of the event beside it.
    const rows = buildEventIndex([event("e1"), event("e2", { typeNameEn: "Editorial" })], {
      e1: facts({ judgeIds: ["j1", "j2"], units: [A], round1Ranks: sheet("j1", { a: 1 }) }),
    });

    const e2 = rows.find((row) => row.eventId === "e2");
    expect(e2?.panelSize).toBe(0);
    expect(e2?.state.status).toBe("not-started");
  });
});

describe("NO_JUDGING_FACTS", () => {
  it("cannot be mutated, because every factless event shares it", () => {
    // Without the freeze, one page pushing a judge onto this array would silently
    // seat that judge on every event in the division.
    expect(() => NO_JUDGING_FACTS.judgeIds.push("j1")).toThrow(TypeError);
    expect(NO_JUDGING_FACTS.judgeIds).toEqual([]);
  });
});

describe("buildEventIndex ordering", () => {
  it("lists contests in catalog order, then by slot", () => {
    const rows = buildEventIndex([
      event("b-fil", { sortOrder: 2, typeNameEn: "Editorial", language: "filipino" }),
      event("b-eng", { sortOrder: 2, typeNameEn: "Editorial" }),
      event("a-sec", { sortOrder: 1, level: "secondary" }),
      event("a-elem", { sortOrder: 1 }),
    ]);

    // sort_order first, so News Writing's events sit together above Editorial's;
    // then EVENT_SLOTS order within a contest, so elementary English is always the
    // first of the four.
    expect(rows.map((row) => row.eventId)).toEqual(["a-elem", "a-sec", "b-eng", "b-fil"]);
  });

  it("does not leak the sort key onto the row", () => {
    const [row] = buildEventIndex([event("e1")]);
    expect("sortOrder" in row).toBe(false);
  });
});

describe("eventIndexSummary", () => {
  it("counts off the rows the table renders", () => {
    const rows = buildEventIndex(
      [event("e1", { entries: 3 }), event("e2", { entries: 4 }), event("e3", { entries: 0 })],
      {
        e1: facts({
          judgeIds: ["j1"],
          units: [A],
          round1Ranks: sheet("j1", { a: 1 }),
        }),
        e2: facts({
          judgeIds: ["j1"],
          units: [A],
          round1Ranks: sheet("j1", { a: 1 }),
          round2Units: [A],
          round2Ranks: sheet("j1", { a: 1 }),
          rounds: {
            round1ClosedAt: "2026-08-20T00:00:00Z",
            round2CutUsed: 10,
            resultsLockedAt: "2026-08-21T00:00:00Z",
          },
        }),
      }
    );

    expect(eventIndexSummary(rows)).toEqual({
      events: 3,
      entries: 7,
      withPanel: 2,
      awaitingAction: 1,
      locked: 1,
      notStarted: 1,
    });
  });

  it("reports zeroes for an empty index without inventing an event", () => {
    expect(eventIndexSummary([])).toEqual({
      events: 0,
      entries: 0,
      withPanel: 0,
      awaitingAction: 0,
      locked: 0,
      notStarted: 0,
    });
  });
});
