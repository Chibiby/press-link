import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_NAV, isNavActive, pendingNavHref, resolveNavPath } from "./nav";

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

describe("Reports group", () => {
  // School Summary and Overall Data were removed from the rail without deleting their
  // routes, so this pins the group to what should remain rather than just asserting
  // an absence.
  const reports = ADMIN_NAV.find((group) => group.label === "Reports");

  it("no longer lists School Summary", () => {
    expect(reports?.items.some((item) => item.href === "/admin/summary")).toBe(false);
  });

  it("no longer lists Overall Data", () => {
    expect(reports?.items.some((item) => item.href === "/admin/overall-data")).toBe(false);
  });

  it("keeps the other two items in order", () => {
    expect(reports?.items.map((item) => item.href)).toEqual([
      "/admin/activity",
      "/admin/masterlist",
    ]);
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
      "/admin/settings",
    ]);
  });
});

describe("resolveNavPath", () => {
  it("uses the real pathname when nothing is pending", () => {
    expect(resolveNavPath("/admin/entries", null)).toBe("/admin/entries");
  });

  it("uses the clicked href while the URL has not moved yet", () => {
    // The frame after the click: the router is still fetching, usePathname()
    // still says /admin, and the rail must already show Entries.
    expect(resolveNavPath("/admin", { href: "/admin/entries", from: "/admin" })).toBe(
      "/admin/entries"
    );
  });

  it("drops the clicked href once the URL has arrived", () => {
    expect(
      resolveNavPath("/admin/entries", { href: "/admin/entries", from: "/admin" })
    ).toBe("/admin/entries");
  });

  it("drops the clicked href when the URL moved somewhere else entirely", () => {
    // Back button pressed mid-navigation. Holding the pending href here would
    // leave Entries lit on a page that is not Entries, permanently.
    expect(resolveNavPath("/admin/schools", { href: "/admin/entries", from: "/admin" })).toBe(
      "/admin/schools"
    );
  });

  it("resolves a deep destination the clicked item still covers", () => {
    // /admin/judges/abc lights Judges Portal either way, but only because the
    // real pathname is used once it arrives — the pending record is stale.
    const path = resolveNavPath("/admin/judges/abc", {
      href: "/admin/judges",
      from: "/admin",
    });
    expect(path).toBe("/admin/judges/abc");
    expect(isNavActive(path, "/admin/judges")).toBe(true);
  });

  it("lights the clicked item and nothing else", () => {
    // The property the sidebar actually depends on: exactly one item is active
    // during the pending frame, and it is the one that was clicked.
    const path = resolveNavPath("/admin", { href: "/admin/tabulators", from: "/admin" });
    const active = ADMIN_NAV.flatMap((group) => group.items).filter((item) =>
      isNavActive(path, item.href)
    );
    expect(active.map((item) => item.href)).toEqual(["/admin/tabulators"]);
  });
});

describe("pendingNavHref", () => {
  it("is null with no pending click", () => {
    expect(pendingNavHref("/admin", null)).toBeNull();
  });

  it("is null once the pathname has changed", () => {
    expect(pendingNavHref("/admin/events", { href: "/admin/events", from: "/admin" })).toBeNull();
  });

  it("keeps the href while the pathname is unchanged", () => {
    expect(pendingNavHref("/admin", { href: "/admin/events", from: "/admin" })).toBe(
      "/admin/events"
    );
  });
});
