import { describe, expect, it } from "vitest";

import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_PARAM,
  countActiveParams,
  filterHref,
  nextFilterQuery,
  searchParamValue,
} from "./filter-params";

describe("SEARCH_PARAM", () => {
  it("is `q`, and is not spelled out anywhere else", () => {
    // Pinned by a test because every page and every filter bar has to agree on
    // it, and the failure mode of a disagreement is silent: a box that types
    // into a param nothing reads.
    expect(SEARCH_PARAM).toBe("q");
  });

  it("does not collide with a param an existing bar already writes", () => {
    const taken = [
      "district",
      "school",
      "event",
      "category",
      "level",
      "language",
      "status",
      "lock",
      "gender",
      "multi",
      "unassigned",
    ];
    expect(taken).not.toContain(SEARCH_PARAM);
  });
});

describe("SEARCH_DEBOUNCE_MS", () => {
  it("stays in the search-as-you-type window", () => {
    // Below 200ms it fires mid-word; above 300ms the pause reads as the page
    // being slow. If this ever needs to move, move it inside the window or
    // rewrite the reasoning in the source, not just the number.
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(200);
    expect(SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(300);
  });
});

describe("nextFilterQuery", () => {
  it("sets a key on an empty query string", () => {
    expect(nextFilterQuery("", "district", "d1")).toBe("district=d1");
  });

  it("replaces a key in place, leaving the others where they were", () => {
    expect(nextFilterQuery("district=d1&school=s1", "district", "d2")).toBe(
      "district=d2&school=s1"
    );
  });

  it("appends a key it has not seen before", () => {
    expect(nextFilterQuery("district=d1", "school", "s1")).toBe(
      "district=d1&school=s1"
    );
  });

  it("deletes the key when there is no value", () => {
    expect(nextFilterQuery("district=d1&school=s1", "district", null)).toBe(
      "school=s1"
    );
    expect(nextFilterQuery("district=d1&school=s1", "district", "")).toBe("school=s1");
  });

  it("returns an empty string once the last filter is gone", () => {
    expect(nextFilterQuery("district=d1", "district", null)).toBe("");
  });

  it("is unbothered by deleting a key that was never set", () => {
    expect(nextFilterQuery("school=s1", "district", null)).toBe("school=s1");
  });

  it("clears the params that cannot hold at the same time as this one", () => {
    // "In more than one event" and "in no event" are complements: switching one
    // on drops the other in the same navigation rather than leaving a URL that
    // asks for both.
    expect(nextFilterQuery("multi=1", "unassigned", "1", ["multi"])).toBe(
      "unassigned=1"
    );
    expect(nextFilterQuery("district=d1&multi=1", "unassigned", "1", ["multi"])).toBe(
      "district=d1&unassigned=1"
    );
  });

  it("clears more than one companion key when asked", () => {
    expect(nextFilterQuery("a=1&b=1&c=1", "d", "1", ["a", "c"])).toBe("b=1&d=1");
  });

  it("lets a clear key win over the key being set, if a caller names both", () => {
    // Nonsense input, but it should be predictable nonsense: the deletes run
    // last, so the result is a URL with neither, not a half-applied one.
    expect(nextFilterQuery("", "multi", "1", ["multi"])).toBe("");
  });

  it("encodes a value that would otherwise break the query string", () => {
    // A search box takes whatever is typed, including "&" and spaces.
    expect(nextFilterQuery("", SEARCH_PARAM, "dela cruz")).toBe("q=dela+cruz");
    expect(nextFilterQuery("", SEARCH_PARAM, "a&b=c")).toBe("q=a%26b%3Dc");
    expect(
      new URLSearchParams(nextFilterQuery("", SEARCH_PARAM, "a&b=c")).get("q")
    ).toBe("a&b=c");
  });

  it("composes, so two changes can land in one navigation", () => {
    // What the hook does when a select is clicked while a search write is still
    // waiting: both changes go into one query string and one history entry.
    const afterSelect = nextFilterQuery("q=cruz", "district", "d1");
    expect(nextFilterQuery(afterSelect, SEARCH_PARAM, "reyes")).toBe(
      "q=reyes&district=d1"
    );
  });

  it("keeps a param it has never heard of", () => {
    // Sorting and paging params belong to other controls on the page; a filter
    // change must not throw them away.
    expect(nextFilterQuery("page=3", "district", "d1")).toBe("page=3&district=d1");
  });
});

describe("filterHref", () => {
  it("hangs the query off the path", () => {
    expect(filterHref("/admin/participants", "district=d1")).toBe(
      "/admin/participants?district=d1"
    );
  });

  it("leaves the bare path when nothing is set", () => {
    // Not "/admin/participants?", which is what naive concatenation leaves
    // behind when the last filter is cleared.
    expect(filterHref("/admin/participants", "")).toBe("/admin/participants");
  });

  it("works for the root path too", () => {
    expect(filterHref("/", "q=cruz")).toBe("/?q=cruz");
    expect(filterHref("/", "")).toBe("/");
  });
});

describe("searchParamValue", () => {
  it("returns the trimmed text", () => {
    expect(searchParamValue("cruz")).toBe("cruz");
    expect(searchParamValue("  dela cruz  ")).toBe("dela cruz");
  });

  it("returns null for a box with nothing in it", () => {
    // So the param is removed rather than left as `?q=`, which would keep the
    // Clear button on screen with nothing to clear.
    expect(searchParamValue("")).toBe(null);
    expect(searchParamValue("   ")).toBe(null);
    expect(searchParamValue("\t\n")).toBe(null);
  });

  it("leaves the spaces inside a query alone", () => {
    expect(searchParamValue(" dela  cruz ")).toBe("dela  cruz");
  });
});

describe("countActiveParams", () => {
  const keys = ["district", "school", SEARCH_PARAM] as const;

  it("counts nothing on a bare URL", () => {
    expect(countActiveParams(new URLSearchParams(""), keys)).toBe(0);
  });

  it("counts each key that is set", () => {
    expect(countActiveParams(new URLSearchParams("district=d1"), keys)).toBe(1);
    expect(countActiveParams(new URLSearchParams("district=d1&q=cruz"), keys)).toBe(2);
  });

  it("counts a search the same as any other filter", () => {
    // A bar that leaves the search param out of its key list renders no Clear
    // button for a reader who arrived on a searched URL.
    expect(countActiveParams(new URLSearchParams("q=cruz"), keys)).toBe(1);
  });

  it("does not count an empty value", () => {
    expect(countActiveParams(new URLSearchParams("q="), keys)).toBe(0);
  });

  it("ignores params that are not in the list", () => {
    expect(countActiveParams(new URLSearchParams("page=3&sort=name"), keys)).toBe(0);
  });

  it("counts a repeated key once", () => {
    expect(countActiveParams(new URLSearchParams("district=d1&district=d2"), keys)).toBe(
      1
    );
  });
});
