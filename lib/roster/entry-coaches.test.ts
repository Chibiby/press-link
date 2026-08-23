import { describe, expect, it } from "vitest";

import { coachedContestants, distinctCoaches } from "./entry-coaches";

const link = (id: string, full_name: string) => ({ coaches: { id, full_name } });

describe("distinctCoaches", () => {
  it("returns one person per coach, however many contestants they take", () => {
    expect(
      distinctCoaches([link("c1", "Reyes, Mario"), link("c1", "Reyes, Mario")])
    ).toEqual([{ id: "c1", full_name: "Reyes, Mario" }]);
  });

  it("keeps two coaches who happen to share a name", () => {
    expect(distinctCoaches([link("c1", "Santos, Maria"), link("c2", "Santos, Maria")])).toHaveLength(
      2
    );
  });

  it("keeps first-seen order", () => {
    const rows = distinctCoaches([
      link("c2", "Cruz, Ana"),
      link("c1", "Reyes, Mario"),
      link("c2", "Cruz, Ana"),
    ]);
    expect(rows.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("skips a link whose coach did not join, and takes nothing at all", () => {
    expect(distinctCoaches([{ coaches: null }, link("c1", "Reyes, Mario")])).toHaveLength(1);
    expect(distinctCoaches([])).toEqual([]);
    expect(distinctCoaches(null)).toEqual([]);
    expect(distinctCoaches(undefined)).toEqual([]);
  });
});

const learner = (id: string, participant_number: number) => ({ id, participant_number });
const coach = (id: string, full_name: string) => ({ id, full_name });

describe("coachedContestants", () => {
  it("names the same coach under every contestant they take", () => {
    const rows = coachedContestants(
      [learner("p1", 1232), learner("p2", 1233)],
      [coach("c1", "Reyes, Mario")],
      { p1: "c1", p2: "c1" }
    );
    expect(rows.map((row) => row.coach?.full_name)).toEqual(["Reyes, Mario", "Reyes, Mario"]);
  });

  it("reads in roster order, whatever order the entry stored", () => {
    const rows = coachedContestants(
      [learner("p2", 1234), learner("p1", 1232), learner("p3", 1233)],
      [],
      {}
    );
    expect(rows.map((row) => row.participant.id)).toEqual(["p1", "p3", "p2"]);
  });

  it("leaves a contestant nobody was matched to without a coach", () => {
    const rows = coachedContestants(
      [learner("p1", 1), learner("p2", 2)],
      [coach("c1", "Reyes, Mario")],
      { p1: "c1" }
    );
    expect(rows[1].coach).toBeNull();
  });

  it("ignores a pairing that names a coach the entry does not have", () => {
    const rows = coachedContestants([learner("p1", 1)], [coach("c1", "Reyes, Mario")], {
      p1: "c9",
    });
    expect(rows[0].coach).toBeNull();
  });

  it("does not reorder the list it was given", () => {
    const participants = [learner("p2", 2), learner("p1", 1)];
    coachedContestants(participants, [], {});
    expect(participants.map((row) => row.id)).toEqual(["p2", "p1"]);
  });
});
