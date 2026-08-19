import { describe, expect, it } from "vitest";

import { ADMIN_NAV, isNavActive } from "./nav";

describe("isNavActive", () => {
  it("matches the dashboard root exactly", () => {
    expect(isNavActive("/admin", "/admin")).toBe(true);
  });

  it("does not light up the dashboard on a child route", () => {
    expect(isNavActive("/admin/entries", "/admin")).toBe(false);
  });

  it("matches a section on its own path", () => {
    expect(isNavActive("/admin/entries", "/admin/entries")).toBe(true);
  });

  it("matches a section on a nested path", () => {
    expect(isNavActive("/admin/entries/abc-123", "/admin/entries")).toBe(true);
  });

  it("does not match a sibling that shares a prefix", () => {
    expect(isNavActive("/admin/entries-archive", "/admin/entries")).toBe(false);
  });
});

describe("ADMIN_NAV", () => {
  const items = ADMIN_NAV.flatMap((group) => group.items);

  it("starts with the dashboard", () => {
    expect(ADMIN_NAV[0]?.items[0]?.href).toBe("/admin");
  });

  it("has no duplicate hrefs", () => {
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });

  it("gives every item a non-empty label and an /admin href", () => {
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.href.startsWith("/admin")).toBe(true);
    }
  });

  it("leaves live only the routes that exist after phase 1", () => {
    const live = items.filter((i) => !i.soon).map((i) => i.href).sort();
    expect(live).toEqual([
      "/admin",
      "/admin/coaches",
      "/admin/entries",
      "/admin/participants",
      "/admin/school-papers",
    ]);
  });
});
