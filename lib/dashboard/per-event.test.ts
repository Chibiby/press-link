import { describe, expect, it } from "vitest";

import { countByEventType, summarisePerEvent, type EventTypeCount } from "./per-event";

function type(typeName: string, entries: number): EventTypeCount {
  return { typeId: typeName.toLowerCase().replace(/\s+/g, "-"), typeName, entries };
}

describe("summarisePerEvent", () => {
  it("ranks by entries descending and shares sum to one", () => {
    const summary = summarisePerEvent(
      [type("Editorial Writing", 20), type("News Writing", 30), type("Photojournalism", 50)],
      { topN: 8, typesTotal: 16 }
    );
    expect(summary.slices.map((s) => s.label)).toEqual([
      "Photojournalism",
      "News Writing",
      "Editorial Writing",
    ]);
    expect(summary.totalEntries).toBe(100);
    expect(summary.slices.map((s) => s.share)).toEqual([0.5, 0.3, 0.2]);
  });

  it("drops event types nobody entered", () => {
    const summary = summarisePerEvent(
      [type("Radio Broadcasting", 4), type("Collaborative Publishing", 0)],
      { topN: 8, typesTotal: 16 }
    );
    expect(summary.slices.map((s) => s.label)).toEqual(["Radio Broadcasting"]);
    expect(summary.typesWithEntries).toBe(1);
    expect(summary.typesTotal).toBe(16);
  });

  it("collapses the tail past topN into one Other slice", () => {
    const counts = [
      ...Array.from({ length: 8 }, (_, i) => type(`Top ${i}`, 20 - i)),
      type("Tail A", 3),
      type("Tail B", 2),
      type("Tail C", 1),
    ];
    const summary = summarisePerEvent(counts, { topN: 8, typesTotal: 16 });
    expect(summary.slices).toHaveLength(9);
    const other = summary.slices.at(-1)!;
    expect(other).toMatchObject({ label: "Other", entries: 6, isOther: true });
    expect(summary.otherTypes).toBe(3);
    // The head holds 20..13, which sums to 132; the tail adds 3 + 2 + 1 = 6.
    expect(summary.totalEntries).toBe(138);
  });

  it("adds no Other slice when everything fits", () => {
    const summary = summarisePerEvent([type("Alfa", 2), type("Bravo", 1)], {
      topN: 8,
      typesTotal: 16,
    });
    expect(summary.slices.some((s) => s.isOther)).toBe(false);
    expect(summary.otherTypes).toBe(0);
  });

  it("cycles the chart tokens and gives Other its own", () => {
    const counts = Array.from({ length: 10 }, (_, i) => type(`Type ${i}`, 20 - i));
    const summary = summarisePerEvent(counts, { topN: 8, typesTotal: 16 });
    expect(summary.slices.map((s) => s.colorVar)).toEqual([
      "--color-chart-1",
      "--color-chart-2",
      "--color-chart-3",
      "--color-chart-4",
      "--color-chart-5",
      "--color-chart-6",
      "--color-chart-7",
      "--color-chart-8",
      "--color-chart-other",
    ]);
  });

  it("breaks ties on name so the ring is stable between renders", () => {
    const summary = summarisePerEvent([type("Zulu", 5), type("Alfa", 5)], {
      topN: 8,
      typesTotal: 16,
    });
    expect(summary.slices.map((s) => s.label)).toEqual(["Alfa", "Zulu"]);
  });

  it("survives a division with no entries yet", () => {
    const summary = summarisePerEvent([type("Alfa", 0)], { topN: 8, typesTotal: 16 });
    expect(summary.slices).toEqual([]);
    expect(summary.totalEntries).toBe(0);
    expect(summary.typesWithEntries).toBe(0);
  });

  it("does not reorder the caller's array", () => {
    const counts = [type("Bravo", 1), type("Alfa", 9)];
    summarisePerEvent(counts, { topN: 8, typesTotal: 16 });
    expect(counts.map((c) => c.typeName)).toEqual(["Bravo", "Alfa"]);
  });
});

describe("countByEventType", () => {
  it("counts one row per entry into one row per type", () => {
    const counts = countByEventType([
      { typeId: "t1", typeName: "News Writing" },
      { typeId: "t2", typeName: "Editorial Writing" },
      { typeId: "t1", typeName: "News Writing" },
    ]);

    expect(counts).toEqual([
      { typeId: "t1", typeName: "News Writing", entries: 2 },
      { typeId: "t2", typeName: "Editorial Writing", entries: 1 },
    ]);
  });

  it("returns an empty list for no rows, not a zero-filled one", () => {
    // A district with no entries must produce an empty table, not sixteen zeroes.
    expect(countByEventType([])).toEqual([]);
  });

  it("keeps first-seen order, leaving the ranking to summarisePerEvent", () => {
    const counts = countByEventType([
      { typeId: "b", typeName: "Bravo" },
      { typeId: "a", typeName: "Alpha" },
      { typeId: "a", typeName: "Alpha" },
    ]);

    expect(counts.map((c) => c.typeId)).toEqual(["b", "a"]);
  });
});
