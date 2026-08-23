import { existsSync } from "node:fs";
import path from "node:path";

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

  /** `/admin/entries` -> `app/admin/(shell)/entries/page.tsx`; `/admin` -> the group root. */
  function pageFileFor(href: string): string {
    // path.join drops empty segments, so the root href resolves to the group's own page.
    const segment = href.replace(/^\/admin\/?/, "");
    return path.join(process.cwd(), "app", "admin", "(shell)", segment, "page.tsx");
  }

  it("links an item exactly when its route file exists", () => {
    // The promise this file exists to keep: `soon` means unlinked, and unlinked must mean
    // there is genuinely nothing to link to. Checking the filesystem rather than a list is
    // what lets every later task clear its flag without coming back to edit this test —
    // and what makes clearing a flag without shipping the page fail here instead of in
    // production as a 404 in the sidebar.
    for (const item of items) {
      expect({ href: item.href, hasPage: existsSync(pageFileFor(item.href)) }).toEqual({
        href: item.href,
        hasPage: !item.soon,
      });
    }
  });
});

describe("stub and soon flags", () => {
  const items = ADMIN_NAV.flatMap((group) => group.items);

  it("never marks an item both soon and stub", () => {
    // `soon` means there is no route; `stub` means there is one. Both at once
    // would make AdminNav's rendering order the tie-breaker, which is a bug
    // waiting for whoever reorders those branches.
    expect(items.filter((item) => item.soon && item.stub)).toEqual([]);
  });

  it("marks exactly the four feature-less routes as stubs", () => {
    // The adjudication pair left this list when they stopped rendering SoonPage.
    // They are not finished features, but they are no longer stubs either: they draw
    // their real tables over the real event catalog and label the figures the
    // judging schema cannot supply yet.
    //
    // Masterlist is in nav order, not System order: it sits in Reports, so it comes
    // first here. toEqual is order-sensitive, which is the point — the list is
    // pinned to the rail's reading order, not to a set.
    expect(items.filter((item) => item.stub).map((item) => item.href)).toEqual([
      "/admin/masterlist",
      "/admin/users",
      "/admin/settings",
      "/admin/audit-logs",
    ]);
  });
});
