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
  const judgeIds = overrides.judgeIds ?? [];
  return {
    judgeIds,
    // The panel arrives in seat order, so the first judge holds seat 1 and is the
    // one who ranks round 1 (N1). Overridable below for the tests that need to
    // say otherwise.
    round1JudgeId: judgeIds[0] ?? null,
    // Round 1 is finished when the judge submits, never when the board looks
    // full: a cut is finished with rows still blank (N2, N6).
    round1SubmittedAt: null,
    units: [],
    round1Ranks: [],
    round2Units: [],
    round2Ranks: [],
    rounds: { round1ClosedAt: null, round1LockedAt: null, round2CutUsed: null, resultsLockedAt: null },
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
  // A read that came back with nothing for this event: no judge, no rank, and — the
  // one that matters — no cut. The status below is produced by the real
  // eventJudgingStatus over a genuinely empty panel, not by a stub.
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
    // `events.round2_cut` is `not null default 30`, so a null here is a value that
    // could not be read. Substituting 10 would report a decision nobody took.
    expect(rows[0].round2Cut).toBeNull();
  });

  it("draws no standings at all with no cut, and counts nobody placed", () => {
    // With no cut there is no field to divide. null rather than an empty array: an
    // empty one would read as an event with no contestants, and 0 placed would read
    // as a field nobody has ranked (non-negotiable 5).
    expect(rows[0].standings).toBeNull();
    expect(rows[0].placed).toBeNull();
  });

  it("still carries the real entry count, which does not depend on judging", () => {
    expect(rows[0].entries).toBe(4);
  });
});

describe("buildEventIndex with facts", () => {
  it("reads a submitted round 1 off the sheet and asks the admin to lock it", () => {
    // The submission is what finishes round 1, not a full board (N6). Both facts
    // are supplied here because they are genuinely independent: the judge has
    // ranked and has also pressed submit.
    const rows = buildEventIndex([event("e1", { entries: 2 })], {
      e1: facts({
        judgeIds: ["j1"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round1SubmittedAt: "2026-08-20T00:00:00Z",
        round2Cut: 10,
      }),
    });

    expect(rows[0].panelSize).toBe(1);
    expect(rows[0].round1Cut?.scored).toBe(2);
    expect(rows[0].state.status).toBe("round1-awaiting-close");
    expect(rows[0].round2Cut).toBe(10);
  });

  it("draws qualifiers off a cut that leaves rows blank, which the panel board cannot", () => {
    // The reason `round1Cut` exists. `consolidateRound` reads the blank third row
    // as a missing opinion and refuses to rank anything (non-negotiable 4), so
    // the panel board beside it qualifies nobody — while the cut qualifies two.
    const C = unit("0003", "c");
    const rows = buildEventIndex([event("e1", { entries: 3 })], {
      e1: facts({
        judgeIds: ["j1"],
        units: [A, B, C],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round1SubmittedAt: "2026-08-20T00:00:00Z",
        round2Cut: 2,
      }),
    });

    expect(rows[0].round1.complete).toBe(false);
    expect(rows[0].round1.rows.every((row) => row.rank === null)).toBe(true);
    expect(rows[0].standings?.filter((row) => row.qualified).map((row) => row.code)).toEqual([
      "0001",
      "0002",
    ]);
  });

  it("keeps the panel board for a group event, whose model is untouched (NN6)", () => {
    const rows = buildEventIndex([event("g1", { category: "group", entries: 2 })], {
      g1: facts({
        judgeIds: ["j1"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round2Cut: 10,
      }),
    });

    expect(rows[0].round1Cut).toBeNull();
    expect(rows[0].round1.complete).toBe(true);
  });

  it("carries the standings the pages draw, rather than leaving each to recompute", () => {
    // The index's Placed column and the event page's sheet read this one array, so
    // they cannot disagree about a placement. Both units are under a cut of 10, so
    // both qualify and neither is placed until round 2 finishes.
    const rows = buildEventIndex([event("e1", { entries: 2 })], {
      e1: facts({
        judgeIds: ["j1"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round2Cut: 10,
      }),
    });

    expect(rows[0].standings?.map((row) => row.code)).toEqual(["0001", "0002"]);
    expect(rows[0].standings?.every((row) => row.qualified)).toBe(true);
    expect(rows[0].placed).toBe(0);
  });

  it("counts a placement only once the round that decides it has finished", () => {
    // A cut of 1 eliminates B and sends A to round 2. Under N4 the eliminated row
    // has no placement at all, so nothing is placed until round 2 finishes: 0
    // here, and 1 — the qualifier alone — below.
    // Seat 1 cuts, and does not also place the winners (N1) — so the round 2
    // ranks below come from j2, not from the judge who ranked round 1.
    const half = buildEventIndex([event("e1", { entries: 2 })], {
      e1: facts({
        judgeIds: ["j1", "j2"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round2Units: [A],
        round2Cut: 1,
      }),
    });
    expect(half[0].placed).toBe(0);

    const done = buildEventIndex([event("e1", { entries: 2 })], {
      e1: facts({
        judgeIds: ["j1", "j2"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round2Units: [A],
        round2Ranks: sheet("j2", { a: 1 }),
        round2Cut: 1,
      }),
    });
    expect(done[0].placed).toBe(1);
  });

  it("draws the standings under the cut round 1 actually closed on", () => {
    // `events.round2_cut` is live and an admin may move it after the fact. Standings
    // drawn under a cut nobody competed under would reshuffle a settled field, so
    // round2_cut_used wins where it exists.
    const rows = buildEventIndex([event("e1", { entries: 2 })], {
      e1: facts({
        judgeIds: ["j1"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round2Cut: 10,
        rounds: {
          round1ClosedAt: "2026-08-20T00:00:00Z",
          round1LockedAt: "2026-08-20T00:00:00Z",
          round2CutUsed: 1,
          resultsLockedAt: null,
        },
      }),
    });

    expect(rows[0].standings?.filter((row) => row.qualified)).toHaveLength(1);
  });

  it("reports a partly-filed round 1 as open, quoting progress", () => {
    const rows = buildEventIndex([event("e1")], {
      e1: facts({
        judgeIds: ["j1", "j2"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
      }),
    });

    // Two of the two ranks seat 1 has to file. Not "2 of 4": round 1 is one
    // judge (N1), and counting the round 2 panel into its denominator would
    // report a finished cut as half done.
    expect(rows[0].state.status).toBe("round1-open");
    expect(rows[0].state.reason).toContain("2 of 2 ranks filed");
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
          round1SubmittedAt: "2026-08-20T00:00:00Z",
        }),
        e2: facts({
          judgeIds: ["j1", "j2"],
          units: [A],
          round1Ranks: sheet("j1", { a: 1 }),
          round1SubmittedAt: "2026-08-20T00:00:00Z",
          round2Units: [A],
          round2Ranks: sheet("j2", { a: 1 }),
          rounds: {
            round1ClosedAt: "2026-08-20T00:00:00Z",
            round1LockedAt: "2026-08-20T00:00:00Z",
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
      // e2 drew its one unit into round 2 and locked it; e1 has not closed round 1.
      qualifiers: 1,
      placed: 1,
      // e1 and e3 have no cut on file, so neither has a field that could be placed.
      withoutCut: 2,
      locked: 1,
      notStarted: 1,
    });
  });

  it("names the events it could not count rather than folding them in as noughts", () => {
    // A plain sum would report fewer placements than the division has made and give
    // no sign that an event was left out of it (non-negotiable 5).
    const rows = buildEventIndex([event("e1"), event("e2")], {
      e1: facts({
        judgeIds: ["j1", "j2"],
        units: [A, B],
        round1Ranks: sheet("j1", { a: 1, b: 2 }),
        round2Units: [A],
        round2Ranks: sheet("j2", { a: 1 }),
        round2Cut: 1,
      }),
      e2: facts({ round2Cut: null }),
    });

    const summary = eventIndexSummary(rows);
    // e1 placed its one qualifier; e2's cut could not be read, so it contributes
    // nothing here and is named in `withoutCut` instead.
    expect(summary.placed).toBe(1);
    expect(summary.withoutCut).toBe(1);
  });

  it("reports zeroes for an empty index without inventing an event", () => {
    expect(eventIndexSummary([])).toEqual({
      events: 0,
      entries: 0,
      withPanel: 0,
      awaitingAction: 0,
      qualifiers: 0,
      placed: 0,
      withoutCut: 0,
      locked: 0,
      notStarted: 0,
    });
  });
});
