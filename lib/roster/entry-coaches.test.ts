import { describe, expect, it } from "vitest";

import { distinctCoaches } from "./entry-coaches";

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
