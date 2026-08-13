import { describe, expect, it } from "vitest";
import { EVENTS_CATALOG } from "./events-catalog";

describe("EVENTS_CATALOG", () => {
  it("has exactly 56 events", () => {
    expect(EVENTS_CATALOG.length).toBe(56);
  });

  it("has 38 individual and 18 group events", () => {
    expect(EVENTS_CATALOG.filter((e) => e.category === "individual").length).toBe(38);
    expect(EVENTS_CATALOG.filter((e) => e.category === "group").length).toBe(18);
  });

  it("has unique codes", () => {
    const codes = EVENTS_CATALOG.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("only offers MOJO at the secondary level", () => {
    const mojo = EVENTS_CATALOG.filter((e) => e.name === "MOJO");
    expect(mojo.every((e) => e.level === "secondary")).toBe(true);
    expect(mojo.length).toBe(2);
  });
});
