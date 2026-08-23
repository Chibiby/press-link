import { describe, expect, it } from "vitest";

import { summarisePerSchool, type SchoolRollupRow } from "@/lib/dashboard/per-school";
import {
  filterOverallDataRows,
  overallDataEmptyState,
  overallDataExportFilename,
  overallDataListDescription,
  overallDataResetHref,
  overallDataSearchQuery,
} from "./overall-data-filters";

/**
 * The rows this filter receives are `summarisePerSchool(...).rows`, so they are
 * built by running the real function over school literals rather than by writing
 * the ranked array out by hand. That matters for one property in particular: the
 * filter must not reshuffle, and a hand-written array could be in an order
 * `summarisePerSchool` would never produce, so the test would pass while the page
 * listed schools in the wrong order.
 *
 * There is no purer mapper to reach for — `SchoolRollupRow[]` comes off
 * `fetchSchoolFacts`, which is an async Supabase read and cannot run under
 * `environment: "node"`.
 */
const active: SchoolRollupRow[] = [
  {
    schoolId: "s1",
    schoolName: "Bagumbayan ES",
    districtId: "d1",
    districtName: "District I",
    learners: 40,
    coaches: 3,
    entries: 12,
  },
  {
    schoolId: "s2",
    schoolName: "Rizal Central School",
    districtId: "d1",
    districtName: "District I",
    learners: 20,
    coaches: 2,
    entries: 30,
  },
  {
    schoolId: "s3",
    schoolName: "Zamora ES",
    districtId: "d2",
    districtName: "District II",
    learners: 5,
    coaches: 1,
    entries: 3,
  },
];

/** What the page hands the filter: every active school, ranked, nothing cut. */
const summary = summarisePerSchool(active, {
  limit: active.length,
  registeredSchools: 332,
});

const ids = (rows: SchoolRollupRow[]) => rows.map((row) => row.schoolId);

describe("overallDataSearchQuery", () => {
  it("is null when the param is absent, empty or all spaces", () => {
    expect(overallDataSearchQuery({})).toBeNull();
    expect(overallDataSearchQuery({ q: "" })).toBeNull();
    expect(overallDataSearchQuery({ q: "   " })).toBeNull();
  });

  it("trims what it returns, so the message quotes the tidy form", () => {
    expect(overallDataSearchQuery({ q: "  rizal " })).toBe("rizal");
  });

  it("takes the first of a repeated param, as the filter bar's box does", () => {
    expect(overallDataSearchQuery({ q: ["rizal", "zamora"] })).toBe("rizal");
  });

  it("survives an empty repeated param rather than throwing", () => {
    // `?q=` twice reaches the page as `[]`; `.trim()` on that is a 500.
    expect(overallDataSearchQuery({ q: [] })).toBeNull();
  });
});

describe("filterOverallDataRows", () => {
  it("lists every school when nothing is set, in the ranked order", () => {
    expect(ids(filterOverallDataRows(summary.rows, {}))).toEqual(["s2", "s1", "s3"]);
  });

  it("matches the school name, case- and whitespace-insensitively", () => {
    expect(ids(filterOverallDataRows(summary.rows, { q: "  BAGUMBAYAN " }))).toEqual([
      "s1",
    ]);
  });

  it("matches anywhere in the name, not only at the start", () => {
    expect(ids(filterOverallDataRows(summary.rows, { q: "central" }))).toEqual(["s2"]);
  });

  it("keeps the ranked order of whatever survives", () => {
    // "ES" is in two names. They must come back biggest-first, as they were.
    expect(ids(filterOverallDataRows(summary.rows, { q: "es" }))).toEqual(["s1", "s3"]);
  });

  it("does not search the district, which has its own dropdown", () => {
    expect(filterOverallDataRows(summary.rows, { q: "District II" })).toEqual([]);
  });

  it("does not search the count columns", () => {
    // "12" is Bagumbayan's entry count. A quantity is not something anyone is
    // looking a school up by, and matching it would return an arbitrary handful.
    expect(filterOverallDataRows(summary.rows, { q: "12" })).toEqual([]);
  });

  it("returns nothing for a query no school matches", () => {
    // The one filter here whose empty answer is the true answer.
    expect(filterOverallDataRows(summary.rows, { q: "qwerty" })).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(ids(filterOverallDataRows(summary.rows, { q: "  " }))).toEqual([
      "s2",
      "s1",
      "s3",
    ]);
  });

  it("still applies the district, so the page's own narrowing is idempotent", () => {
    expect(ids(filterOverallDataRows(summary.rows, { district: "d1" }))).toEqual([
      "s2",
      "s1",
    ]);
    expect(ids(filterOverallDataRows(summary.rows, { district: "" }))).toEqual([
      "s2",
      "s1",
      "s3",
    ]);
  });

  it("applies the search on top of the district, not instead of it", () => {
    expect(ids(filterOverallDataRows(summary.rows, { q: "es", district: "d1" }))).toEqual(
      ["s1"]
    );
    expect(filterOverallDataRows(summary.rows, { q: "zamora", district: "d1" })).toEqual(
      []
    );
  });

  it("leaves the summary it was given alone", () => {
    // The page keeps the division figures off this same object. A filter that
    // mutated `rows` would take the totals' provenance with it.
    filterOverallDataRows(summary.rows, { q: "zamora" });
    expect(ids(summary.rows)).toEqual(["s2", "s1", "s3"]);
  });

  it("does not move the totals, which is the whole point of filtering rows only", () => {
    // The composition the page performs: summarise the unsearched set, then
    // replace only `rows`. Every figure an officer reads out stays division-wide.
    const shown = filterOverallDataRows(summary.rows, { q: "zamora" });
    const shownSummary = { ...summary, rows: shown };

    expect(ids(shownSummary.rows)).toEqual(["s3"]);
    expect(shownSummary.totals).toEqual({ learners: 65, coaches: 6, entries: 45 });
    expect(shownSummary.activeSchools).toBe(3);
    expect(shownSummary.registeredSchools).toBe(332);
  });
});

describe("overallDataEmptyState", () => {
  it("says nothing is registered only when no control is set", () => {
    expect(overallDataEmptyState({})).toEqual({
      message: "No school has registered a learner, a coach or an entry yet.",
      narrowed: false,
      resetLabel: "Show all schools",
    });
  });

  it("quotes the query back, so a typo is visible", () => {
    const state = overallDataEmptyState({ q: " qwerty " });
    expect(state.message).toBe("No school matches “qwerty”.");
    expect(state.narrowed).toBe(true);
  });

  it("names both causes when a query and a district are set", () => {
    const state = overallDataEmptyState({ q: "zamora", district: "d1" });
    expect(state.message).toBe(
      "No school in the selected district matches “zamora”."
    );
    expect(state.narrowed).toBe(true);
    expect(state.resetLabel).toBe("Show all schools in this district");
  });

  it("keeps a district-only empty district distinct from an empty division", () => {
    const state = overallDataEmptyState({ district: "d9" });
    expect(state.message).toBe(
      "No school in the selected district has registered a learner, a coach or an entry yet."
    );
    expect(state.narrowed).toBe(true);
    expect(state.resetLabel).toBe("Show all districts");
  });

  it("is not narrowed by a blank query or an empty district param", () => {
    // Otherwise the panel offers a way back from a filter that is not on.
    expect(overallDataEmptyState({ q: "   " }).narrowed).toBe(false);
    expect(overallDataEmptyState({ district: "" }).narrowed).toBe(false);
  });
});

describe("overallDataListDescription", () => {
  it("keeps the wording the panel already had when nothing is searched", () => {
    expect(
      overallDataListDescription({}, { shown: 3, activeSchools: 3 })
    ).toBe("All 3, biggest first.");
    expect(
      overallDataListDescription({ district: "d9" }, { shown: 0, activeSchools: 0 })
    ).toBe("No school in this selection has registered anything yet.");
  });

  it("counts against the schools with data, not against what is listed", () => {
    // "1 of 3", so a narrowed list cannot be read as the size of the set.
    expect(
      overallDataListDescription({ q: "zamora" }, { shown: 1, activeSchools: 3 })
    ).toBe(
      "1 of 3 match “zamora”, biggest first. The division total counts all 3."
    );
  });

  it("says the total is unaffected, because the footer's rows will not add up to it", () => {
    expect(
      overallDataListDescription({ q: "es" }, { shown: 2, activeSchools: 3 })
    ).toContain("The division total counts all 3.");
  });

  it("does not promise a total that is not on screen when nothing matches", () => {
    // No quoted query: the message in place of the rows carries that. This half
    // carries the figure it cannot — how many schools have data at all.
    expect(
      overallDataListDescription({ q: "qwerty" }, { shown: 0, activeSchools: 3 })
    ).toBe("3 schools have data. None of them match.");
  });
});

describe("overallDataResetHref", () => {
  it("is the bare path when nothing is set", () => {
    expect(overallDataResetHref({})).toBe("/admin/overall-data");
  });

  it("keeps the district when escaping a search, so no total is re-scoped", () => {
    expect(overallDataResetHref({ q: "zamora", district: "d1" })).toBe(
      "/admin/overall-data?district=d1"
    );
  });

  it("clears the district when the district is the thing to escape", () => {
    expect(overallDataResetHref({ district: "d1" })).toBe("/admin/overall-data");
  });
});

describe("overallDataExportFilename", () => {
  const date = "2026-08-23";

  it("keeps the name officers already have on file when nothing is searched", () => {
    expect(overallDataExportFilename({}, date)).toBe(
      "press-link-overall-data-2026-08-23.xlsx"
    );
    // A district alone is not marked: the sheet's own total row carries the
    // narrowed denominator, and this name has always covered that case.
    expect(overallDataExportFilename({ district: "d1", q: "  " }, date)).toBe(
      "press-link-overall-data-2026-08-23.xlsx"
    );
  });

  it("marks a searched workbook, so it is not forwarded as the full division", () => {
    expect(overallDataExportFilename({ q: "Bagumbayan ES" }, date)).toBe(
      "press-link-overall-data-filtered-bagumbayan-es-2026-08-23.xlsx"
    );
  });

  it("strips anything that could break out of the Content-Disposition header", () => {
    expect(
      overallDataExportFilename({ q: 'a"\r\nX-Evil: 1' }, date)
    ).toBe("press-link-overall-data-filtered-a-x-evil-1-2026-08-23.xlsx");
  });

  it("still says filtered when the query slugs away to nothing", () => {
    expect(overallDataExportFilename({ q: "!!!" }, date)).toBe(
      "press-link-overall-data-filtered-search-2026-08-23.xlsx"
    );
    // Non-ASCII names are ordinary here, and none of it survives the slug.
    expect(overallDataExportFilename({ q: "ñ" }, date)).toBe(
      "press-link-overall-data-filtered-search-2026-08-23.xlsx"
    );
  });

  it("truncates a pasted query and never ends the slug on a dash", () => {
    expect(overallDataExportFilename({ q: "abcdefghijklmnopqrstuvw x" }, date)).toBe(
      "press-link-overall-data-filtered-abcdefghijklmnopqrstuvw-2026-08-23.xlsx"
    );
  });
});
