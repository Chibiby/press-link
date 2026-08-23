import { describe, expect, it } from "vitest";

import {
  ANY,
  filterCoaches,
  filterEntries,
  filterParticipants,
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
  coaches: RosterCoach[] = [],
  category: EntryRow["category"] = "individual"
): EntryRow {
  return {
    id,
    event_id: `event-${id}`,
    submitted_at: "2026-08-22T00:00:00Z",
    submitted_label: "Aug 22, 2026",
    event_type_id: `type-${id}`,
    event_name,
    category,
    level,
    language,
    coachByParticipant: {},
    coachingPending: false,
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

// The `matchesQuery` suite moved with the predicate, to
// `lib/search/matches-query.test.ts`. What is left here is what these three
// filters do with it, which is the part specific to a school's own lists.

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
  // Radio Broadcasting is a group event in the catalog, so the pair covers both
  // halves of the contest without inventing an event that does not exist.
  const radio = entry(
    "e2",
    "Radio Broadcasting",
    "secondary",
    "filipino",
    [BEN],
    [coach("c2", "Santos, Liza", "F")],
    "group"
  );
  const all = [editorial, radio];

  it("returns every entry when nothing is set", () => {
    expect(
      filterEntries(all, { query: "", level: ANY, language: ANY, category: ANY })
    ).toEqual(all);
  });

  it("finds an entry by its event name", () => {
    expect(
      filterEntries(all, { query: "radio", level: ANY, language: ANY, category: ANY })
    ).toEqual([radio]);
  });

  it("finds an entry by a participant on it", () => {
    expect(
      filterEntries(all, { query: "cruz", level: ANY, language: ANY, category: ANY })
    ).toEqual([editorial]);
  });

  it("finds an entry by a coach on it", () => {
    expect(
      filterEntries(all, { query: "santos", level: ANY, language: ANY, category: ANY })
    ).toEqual([radio]);
  });

  it("filters by level and by language", () => {
    expect(
      filterEntries(all, {
        query: "",
        level: "secondary",
        language: ANY,
        category: ANY,
      })
    ).toEqual([radio]);
    expect(
      filterEntries(all, {
        query: "",
        level: ANY,
        language: "english",
        category: ANY,
      })
    ).toEqual([editorial]);
  });

  it("keeps only the requested category", () => {
    expect(
      filterEntries(all, { query: "", level: ANY, language: ANY, category: "group" })
    ).toEqual([radio]);
    expect(
      filterEntries(all, {
        query: "",
        level: ANY,
        language: ANY,
        category: "individual",
      })
    ).toEqual([editorial]);
  });

  it("splits the list into complements, so no entry is hidden from both", () => {
    const base = { query: "", level: ANY, language: ANY } as const;
    const individual = filterEntries(all, { ...base, category: "individual" });
    const group = filterEntries(all, { ...base, category: "group" });

    expect(individual.length + group.length).toBe(all.length);
    expect(individual.some((one) => group.some((other) => other.id === one.id))).toBe(
      false
    );
  });

  it("applies level and language together", () => {
    expect(
      filterEntries(all, {
        query: "",
        level: "secondary",
        language: "filipino",
        category: ANY,
      })
    ).toEqual([radio]);
    expect(
      filterEntries(all, {
        query: "",
        level: "secondary",
        language: "english",
        category: ANY,
      })
    ).toEqual([]);
  });

  it("applies the category alongside every other filter", () => {
    expect(
      filterEntries(all, {
        query: "katigbak",
        level: "secondary",
        language: "filipino",
        category: "group",
      })
    ).toEqual([radio]);
    // The only group entry is the secondary one, so this pair cannot both hold
    // and the search box is not what emptied the list.
    expect(
      filterEntries(all, {
        query: "",
        level: "elementary",
        language: ANY,
        category: "group",
      })
    ).toEqual([]);
  });
});
