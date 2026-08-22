import { describe, expect, it } from "vitest";

import {
  XL_CUT_NOT_SET,
  XL_NO_JUDGES,
  XL_NO_PANEL,
  XL_NO_UNITS,
} from "@/lib/export/judging-workbook";

import {
  CUT_NOT_ON_FILE,
  NO_ENTRIES_TO_RANK,
  NO_JUDGES_ON_FILE,
  NO_PANEL_SEATED,
} from "./empty-states";

/**
 * The screen's sentences and the workbook's copies of them, pinned together.
 *
 * `lib/export/judging-workbook.ts` cannot import these — `lib/` does not import from
 * `components/` — so it declares its own `XL_*` copies, and a copy is a thing that
 * drifts. This test lives on the components side, which may import from `lib/`, so
 * the pairing can be checked without inverting the layering.
 *
 * The workbook's version may say *more*, and two of the four have to: a cell has no
 * tooltip and a downloaded file outlives the page, so a sentence that would be read
 * off a numeric column has to rule out the readings a bare figure invites. The other
 * two already name the absence and why there is no figure, so they travel as they
 * are. What none of them may do is start somewhere else — that is what reading the
 * same absence two different ways looks like.
 *
 * `extended` records which is which, so dropping the spreadsheet-only half of one
 * fails here rather than shipping a cell that can be read as a nought.
 */
const PAIRS: [screen: string, workbook: string, name: string, extended: boolean][] = [
  [NO_PANEL_SEATED, XL_NO_PANEL, "no panel seated", false],
  [NO_ENTRIES_TO_RANK, XL_NO_UNITS, "no entries to rank", false],
  [CUT_NOT_ON_FILE, XL_CUT_NOT_SET, "no round-2 cut on file", true],
  [NO_JUDGES_ON_FILE, XL_NO_JUDGES, "no judges on file", true],
];

describe("the workbook's copies of the screen's absences", () => {
  it.each(PAIRS)("opens with the screen's own wording: %s", (screen, workbook) => {
    expect(workbook.startsWith(screen)).toBe(true);
  });

  it("keeps the extra clause on the two that land in a numeric column", () => {
    // An unread cut and an empty roster both sit where a number belongs, so each has
    // to rule out being read as a nought. Losing that clause is the failure this
    // catches; the other two need no clause and must not grow one silently.
    for (const [screen, workbook, name, extended] of PAIRS) {
      expect(workbook.length > screen.length, name).toBe(extended);
    }
  });

  it("never offers the default of 10 as a stand-in for an unread cut", () => {
    // `events.round2_cut` is `not null default 10`, so a cut that cannot be printed
    // is a value that could not be read. Printing 10 would report a decision nobody
    // took for that event (non-negotiable 5).
    expect(CUT_NOT_ON_FILE).not.toContain("10");
    expect(XL_CUT_NOT_SET).toContain("not the division's usual default of 10");
  });

  it("says nothing about a table being absent, because none of them are", () => {
    // All six judging tables are in the database. An empty table is a fact about the
    // roster, not about the schema, and the two call for different responses.
    for (const [screen, workbook] of PAIRS) {
      expect(screen).not.toMatch(/migration|0018|not in the database/i);
      expect(workbook).not.toMatch(/migration|0018|not in the database/i);
    }
  });
});
