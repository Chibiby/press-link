import { describe, expect, it } from "vitest";

import {
  ANY,
  filterCoaches,
  filterEntries,
  filterParticipants,
  matchesQuery,
} from "./list-filters";
import type { EntryRow, RosterCoach, RosterParticipant } from "./types";
import type { UsageMap } from "@/lib/roster/limits";

function participant(
  id: string,
  full_name: string,
  number_label: string,
  gender: "M" | "F" = "F"
): RosterParticipant {
  return {
    id,
    participant_number: Number(number_label),
    number_label,
    first_name: full_name,
    middle_name: null,
    last_name: full_name,
    gender,
    full_name,
  };
}

function coach(id: string, full_name: string, gender: "M" | "F"): RosterCoach {
  return {
    id,
    first_name: full_name,
    middle_name: null,
    last_name: full_name,
    gender,
    full_name,
  };
}

function entry(
  id: string,
  event_name: string,
  level: EntryRow["level"],
  language: EntryRow["language"],
  participants: RosterParticipant[] = [],
  coaches: RosterCoach[] = []
): EntryRow {
  return {
    id,
    event_id: `event-${id}`,
    submitted_at: "2026-08-22T00:00:00Z",
    submitted_label: "Aug 22, 2026",
    event_type_id: `type-${id}`,
    event_name,
    category: "individual",
    level,
    language,
    participants,
    coaches,
  };
}

const ANA = participant("p1", "Dela Cruz, Ana", "0012");
const BEN = participant("p2", "Katigbak, Ben", "1738", "M");
const CARLA = participant("p3", "Panganiban, Carla", "0099");

/** Ben is deliberately absent: no usage row at all means no entry yet. */
const USAGE: UsageMap = {
  p1: { individualCount: 1, groupCount: 0 },
  p3: { individualCount: 0, groupCount: 0 },
};

describe("matchesQuery", () => {
  it("treats an empty or blank query as no filter", () => {
    expect(matchesQuery(["Dela Cruz, Ana"], "")).toBe(true);
    expect(matchesQuery(["Dela Cruz, Ana"], "   ")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(matchesQuery(["Dela Cruz, Ana"], "  cRUz ")).toBe(true);
  });

  it("matches any one of the fields, and reports a miss on all of them", () => {
    expect(matchesQuery(["Editorial Writing", "Dela Cruz, Ana"], "ana")).toBe(true);
    expect(matchesQuery(["Editorial Writing", "Dela Cruz, Ana"], "reyes")).toBe(false);
  });
});

describe("filterParticipants", () => {
  const all = [ANA, BEN, CARLA];

  it("returns everyone when nothing is set", () => {
    expect(
      filterParticipants(all, { query: "", usage: USAGE, assignment: ANY })
    ).toEqual(all);
  });

  it("matches the name case-insensitively and trimmed", () => {
    expect(
      filterParticipants(all, {
        query: " katigbak ",
        usage: USAGE,
        assignment: ANY,
      })
    ).toEqual([BEN]);
  });

  it("matches the number, which is how a school reads its own forms", () => {
    expect(
      filterParticipants(all, { query: "1738", usage: USAGE, assignment: ANY })
    ).toEqual([BEN]);
  });

  it("counts a participant missing from the usage map as unassigned", () => {
    expect(
      filterParticipants(all, { query: "", usage: USAGE, assignment: "unassigned" })
    ).toEqual([BEN, CARLA]);
  });

  it("splits the roster into complements", () => {
    const assigned = filterParticipants(all, {
      query: "",
      usage: USAGE,
      assignment: "assigned",
    });
    const unassigned = filterParticipants(all, {
      query: "",
      usage: USAGE,
      assignment: "unassigned",
    });

    expect(assigned).toEqual([ANA]);
    expect(assigned.length + unassigned.length).toBe(all.length);
    expect(
      assigned.some((p) => unassigned.some((other) => other.id === p.id))
    ).toBe(false);
  });

  it("applies the search and the assignment filter together", () => {
    expect(
      filterParticipants(all, {
        query: "a",
        usage: USAGE,
        assignment: "assigned",
      })
    ).toEqual([ANA]);
  });
});

describe("filterCoaches", () => {
  const all = [coach("c1", "Reyes, Mario", "M"), coach("c2", "Santos, Liza", "F")];

  it("returns every coach when nothing is set", () => {
    expect(filterCoaches(all, { query: "", gender: ANY })).toEqual(all);
  });

  it("keeps only the requested gender", () => {
    expect(filterCoaches(all, { query: "", gender: "F" })).toEqual([all[1]]);
    expect(filterCoaches(all, { query: "", gender: "M" })).toEqual([all[0]]);
  });

  it("searches the name", () => {
    expect(filterCoaches(all, { query: "SANTOS", gender: ANY })).toEqual([all[1]]);
  });
});

describe("filterEntries", () => {
  const editorial = entry("e1", "Editorial Writing", "elementary", "english", [ANA], [
    coach("c1", "Reyes, Mario", "M"),
  ]);
  const radio = entry("e2", "Radio Broadcasting", "secondary", "filipino", [BEN], [
    coach("c2", "Santos, Liza", "F"),
  ]);
  const all = [editorial, radio];

  it("returns every entry when nothing is set", () => {
    expect(filterEntries(all, { query: "", level: ANY, language: ANY })).toEqual(all);
  });

  it("finds an entry by its event name", () => {
    expect(filterEntries(all, { query: "radio", level: ANY, language: ANY })).toEqual([
      radio,
    ]);
  });

  it("finds an entry by a participant on it", () => {
    expect(filterEntries(all, { query: "cruz", level: ANY, language: ANY })).toEqual([
      editorial,
    ]);
  });

  it("finds an entry by a coach on it", () => {
    expect(filterEntries(all, { query: "santos", level: ANY, language: ANY })).toEqual([
      radio,
    ]);
  });

  it("filters by level and by language", () => {
    expect(
      filterEntries(all, { query: "", level: "secondary", language: ANY })
    ).toEqual([radio]);
    expect(
      filterEntries(all, { query: "", level: ANY, language: "english" })
    ).toEqual([editorial]);
  });

  it("applies level and language together", () => {
    expect(
      filterEntries(all, { query: "", level: "secondary", language: "filipino" })
    ).toEqual([radio]);
    expect(
      filterEntries(all, { query: "", level: "secondary", language: "english" })
    ).toEqual([]);
  });
});
