import { describe, expect, it } from "vitest";

import type { EventMatrixRow } from "@/lib/dashboard/event-matrix";

import { toEventsMatrixRows } from "./events-matrix-workbook";

const row = (over: Partial<EventMatrixRow> = {}): EventMatrixRow => ({
  typeId: "t-feature-writing",
  typeNameEn: "Feature Writing",
  typeNameFil: "Lathalain",
  category: "individual",
  minParticipants: 1,
  maxParticipants: 1,
  sortOrder: 1,
  slots: {
    "elementary-english": { eventId: "e1", entries: 12 },
    "elementary-filipino": { eventId: "e2", entries: 8 },
    "secondary-english": null,
    "secondary-filipino": { eventId: "e3", entries: 5 },
  },
  offered: 3,
  entries: 25,
  ...over,
});

describe("toEventsMatrixRows", () => {
  it("carries the type names, team size and total entries straight across", () => {
    const rows = toEventsMatrixRows([row()]);

    expect(rows).toEqual([
      {
        "Event Type (English)": "Feature Writing",
        "Event Type (Filipino)": "Lathalain",
        "Team Size": "1",
        "Elem · Eng": 12,
        "Elem · Fil": 8,
        "Sec · Eng": "—",
        "Sec · Fil": 5,
        Entries: 25,
      },
    ]);
  });

  it("writes an em dash for a slot that is not offered, not a zero", () => {
    // A slot can also be offered with zero entries — that has to read as `0`,
    // not as "not offered", which is why this checks both against the same row.
    const rows = toEventsMatrixRows([
      row({
        slots: {
          "elementary-english": null,
          "elementary-filipino": null,
          "secondary-english": { eventId: "e1", entries: 0 },
          "secondary-filipino": { eventId: "e2", entries: 0 },
        },
      }),
    ]);

    expect(rows[0]["Elem · Eng"]).toBe("—");
    expect(rows[0]["Elem · Fil"]).toBe("—");
    expect(rows[0]["Sec · Eng"]).toBe(0);
    expect(rows[0]["Sec · Fil"]).toBe(0);
  });

  it("keeps rows in the order given, one per type", () => {
    const rows = toEventsMatrixRows([
      row({ typeId: "a", typeNameEn: "A Contest" }),
      row({ typeId: "b", typeNameEn: "B Contest" }),
    ]);

    expect(rows.map((r) => r["Event Type (English)"])).toEqual(["A Contest", "B Contest"]);
  });

  it("renders a team-size range rather than a bare min–max pair", () => {
    // teamSize() is the same helper the on-screen table uses — this is a
    // regression check that the workbook did not reimplement it inline.
    const rows = toEventsMatrixRows([row({ minParticipants: 2, maxParticipants: null })]);

    expect(rows[0]["Team Size"]).toBe("2 or more");
  });
});
