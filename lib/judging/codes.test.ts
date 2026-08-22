import { describe, expect, it } from "vitest";

import { formatParticipantNumber } from "@/lib/roster/limits";

import { contestUnits, formatContestCode, unitKeyOf, type RawContestEntry } from "./codes";

describe("formatContestCode", () => {
  it("pads to four digits", () => {
    expect(formatContestCode(1)).toBe("0001");
    expect(formatContestCode(42)).toBe("0042");
    expect(formatContestCode(9999)).toBe("9999");
  });

  it("agrees with formatParticipantNumber", () => {
    // For an individual event the contest code IS the participant number. A
    // contestant whose badge reads 0042 must not appear on a sheet as 42, so the
    // two formatters are pinned together rather than merely looking alike.
    for (const n of [1, 7, 99, 100, 1234, 9999]) {
      expect(formatContestCode(n)).toBe(formatParticipantNumber(n));
    }
  });

  it("keeps codes sortable as plain strings", () => {
    // Fixed width is what lets contestUnits sort with localeCompare instead of
    // parsing back to a number. Without the padding "42" would sort after "100".
    expect([formatContestCode(100), formatContestCode(42)].sort()).toEqual(["0042", "0100"]);
  });
});

describe("unitKeyOf", () => {
  it("uses the participant when there is one", () => {
    expect(unitKeyOf("entry-1", "participant-9")).toBe("participant-9");
  });

  it("falls back to the entry for a group unit", () => {
    expect(unitKeyOf("entry-1", null)).toBe("entry-1");
  });

  it("distinguishes contestants who share an entry", () => {
    // The reason the key is not the entry id: an individual event carries up to
    // three contestants on one school's entry and each is ranked separately. If
    // this ever collapses, three placements become one.
    const a = unitKeyOf("entry-1", "participant-1");
    const b = unitKeyOf("entry-1", "participant-2");
    expect(a).not.toBe(b);
  });
});

/** Two contestants on one entry, plus a second entry — the individual-event shape. */
const INDIVIDUAL: RawContestEntry[] = [
  {
    id: "entry-1",
    entry_number: 11,
    entry_participants: [
      { participants: { id: "p-100", participant_number: 100 } },
      { participants: { id: "p-42", participant_number: 42 } },
    ],
  },
  {
    id: "entry-2",
    entry_number: 12,
    entry_participants: [{ participants: { id: "p-7", participant_number: 7 } }],
  },
];

describe("contestUnits — individual events", () => {
  it("ranks each contestant on each entry, not each entry", () => {
    const { units } = contestUnits("individual", INDIVIDUAL);
    expect(units).toHaveLength(3);
    expect(units.map((u) => u.participantId)).toEqual(["p-7", "p-42", "p-100"]);
  });

  it("codes a contestant by their participant number", () => {
    const { units } = contestUnits("individual", INDIVIDUAL);
    expect(units.map((u) => u.code)).toEqual(["0007", "0042", "0100"]);
  });

  it("returns units in code order, not entry order", () => {
    // A judge's sheet is a list of codes; it must read 0007, 0042, 0100 whatever
    // order the entries came back in.
    const { units } = contestUnits("individual", INDIVIDUAL);
    expect(units.map((u) => u.code)).toEqual([...units.map((u) => u.code)].sort());
  });

  it("keys each contestant on their participant id", () => {
    const { units } = contestUnits("individual", INDIVIDUAL);
    expect(units.map((u) => u.unitKey)).toEqual(["p-7", "p-42", "p-100"]);
  });
});

describe("contestUnits — group events", () => {
  it("ranks the team, once per entry", () => {
    const { units } = contestUnits("group", INDIVIDUAL);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.code)).toEqual(["0011", "0012"]);
  });

  it("leaves participantId null, because the team is the unit", () => {
    const { units } = contestUnits("group", INDIVIDUAL);
    expect(units.every((u) => u.participantId === null)).toBe(true);
  });

  it("keys a team on its entry id", () => {
    const { units } = contestUnits("group", INDIVIDUAL);
    expect(units.map((u) => u.unitKey)).toEqual(["entry-1", "entry-2"]);
  });

  it("ignores the entry's participants entirely", () => {
    // A seven-member team produces one row, not seven. This is the whole reason
    // category is a parameter.
    const { units } = contestUnits("group", INDIVIDUAL);
    expect(units).toHaveLength(2);
  });
});

describe("contestUnits — rows that cannot be coded", () => {
  it("reports a team with no entry number instead of coding it 0000", () => {
    const { units, uncoded } = contestUnits("group", [
      { id: "entry-broken", entry_number: null, entry_participants: [] },
    ]);
    expect(units).toEqual([]);
    expect(uncoded).toHaveLength(1);
    expect(uncoded[0]).toMatchObject({ entryId: "entry-broken", participantId: null });
    expect(uncoded[0].reason.length).toBeGreaterThan(0);
  });

  it("reports a contestant with no participant number", () => {
    const { units, uncoded } = contestUnits("individual", [
      {
        id: "entry-1",
        entry_number: 1,
        entry_participants: [{ participants: { id: "p-x", participant_number: null } }],
      },
    ]);
    expect(units).toEqual([]);
    expect(uncoded[0]).toMatchObject({ entryId: "entry-1", participantId: "p-x" });
  });

  it("reports a broken participant join against its entry", () => {
    const { uncoded } = contestUnits("individual", [
      { id: "entry-1", entry_number: 1, entry_participants: [{ participants: null }] },
    ]);
    expect(uncoded).toHaveLength(1);
    expect(uncoded[0].entryId).toBe("entry-1");
  });

  it("keeps the sound rows when one row is broken", () => {
    // Throwing would take down a whole event's sheet over one bad row; the
    // judges can still rank the contestants who do have numbers.
    const { units, uncoded } = contestUnits("individual", [
      ...INDIVIDUAL,
      {
        id: "entry-3",
        entry_number: 13,
        entry_participants: [{ participants: { id: "p-bad", participant_number: null } }],
      },
    ]);
    expect(units).toHaveLength(3);
    expect(uncoded).toHaveLength(1);
  });

  it("never emits a unit with a blank code", () => {
    // The promise the uncoded list exists to keep. A blank code is a row a judge
    // cannot report a problem about and a rank no tabulator could ever identify.
    const { units } = contestUnits("individual", [
      {
        id: "entry-1",
        entry_number: null,
        entry_participants: [{ participants: { id: "p-x", participant_number: null } }],
      },
    ]);
    expect(units.every((u) => u.code.length === 4)).toBe(true);
  });
});

describe("contestUnits — empty", () => {
  it("returns nothing for an event with no entries", () => {
    expect(contestUnits("individual", [])).toEqual({ units: [], uncoded: [] });
    expect(contestUnits("group", [])).toEqual({ units: [], uncoded: [] });
  });

  it("treats a null participant list as no contestants", () => {
    const { units, uncoded } = contestUnits("individual", [
      { id: "entry-1", entry_number: 1, entry_participants: null },
    ]);
    expect(units).toEqual([]);
    expect(uncoded).toEqual([]);
  });
});
