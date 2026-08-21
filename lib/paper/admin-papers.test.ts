import { describe, expect, it } from "vitest";

import {
  filterSchoolPaperRows,
  toAdminSchoolPaperRows,
  type RawAdminSchoolPaper,
} from "./admin-papers";

const raw = (overrides: Partial<RawAdminSchoolPaper> = {}): RawAdminSchoolPaper => ({
  id: "s1",
  name: "Bagumbayan ES",
  district_id: "d1",
  is_integrated: false,
  paper_participation: "yes",
  paper_answered_at: "2026-08-14T02:00:00.000Z",
  submission_locked_at: null,
  districts: { name: "District I" },
  school_papers: [{ language: "english", level: "whole" }],
  ...overrides,
});

/** language:level for every slot the row reports as filled. */
const filled = (slots: { language: string; level: string; filled: boolean }[]) =>
  slots.filter((s) => s.filled).map((s) => s.language + ":" + s.level);

/** language:level for every slot the school owes, filled or not. */
const shape = (slots: { language: string; level: string }[]) =>
  slots.map((s) => s.language + ":" + s.level);

describe("toAdminSchoolPaperRows", () => {
  it("labels a submitted school and lists its languages", () => {
    const [row] = toAdminSchoolPaperRows([raw()]);
    expect(row.status).toBe("submitted");
    expect(row.languages).toEqual(["english"]);
    expect(row.locked).toBe(false);
    expect(row.schoolName).toBe("Bagumbayan ES");
    expect(row.districtName).toBe("District I");
  });

  it("orders languages the way the tabs do, whatever the query returned", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({
        school_papers: [
          { language: "filipino", level: "whole" },
          { language: "english", level: "whole" },
        ],
      }),
    ]);
    expect(row.languages).toEqual(["english", "filipino"]);
  });

  it("marks a locked school", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({ submission_locked_at: "2026-08-14T03:00:00.000Z" }),
    ]);
    expect(row.locked).toBe(true);
  });

  it("calls a school with no papers and no answer not started", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({ paper_participation: "undecided", paper_answered_at: null, school_papers: [] }),
    ]);
    expect(row.status).toBe("incomplete");
    expect(row.languages).toEqual([]);
  });

  it("calls a school that answered no info-saved-only", () => {
    const [row] = toAdminSchoolPaperRows([raw({ paper_participation: "no" })]);
    expect(row.status).toBe("saved");
  });

  it("sorts by school name", () => {
    const rows = toAdminSchoolPaperRows([
      raw({ id: "b", name: "Zamora ES" }),
      raw({ id: "a", name: "Aguinaldo ES" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("toAdminSchoolPaperRows - levels", () => {
  it("gives a non-integrated school two whole slots and nothing else", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({
        school_papers: [
          { language: "english", level: "whole" },
          { language: "filipino", level: "whole" },
        ],
      }),
    ]);
    expect(row.isIntegrated).toBe(false);
    expect(shape(row.slots)).toEqual(["english:whole", "filipino:whole"]);
    expect(filled(row.slots)).toEqual(["english:whole", "filipino:whole"]);
    // On file and complete are the same claim for a school that owes one paper
    // per language, which is what both have always meant here.
    expect(row.languages).toEqual(["english", "filipino"]);
    expect(row.completeLanguages).toEqual(["english", "filipino"]);
  });

  it("leaves the unfiled language out of both lists for a non-integrated school", () => {
    const [row] = toAdminSchoolPaperRows([raw()]);
    expect(shape(row.slots)).toEqual(["english:whole", "filipino:whole"]);
    expect(filled(row.slots)).toEqual(["english:whole"]);
    expect(row.languages).toEqual(["english"]);
    expect(row.completeLanguages).toEqual(["english"]);
  });

  it("gives an integrated school four slots, all filled when all four are on file", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({
        is_integrated: true,
        name: "San Isidro Integrated School",
        school_papers: [
          { language: "english", level: "elementary" },
          { language: "english", level: "secondary" },
          { language: "filipino", level: "elementary" },
          { language: "filipino", level: "secondary" },
        ],
      }),
    ]);
    expect(row.isIntegrated).toBe(true);
    expect(shape(row.slots)).toEqual([
      "english:elementary",
      "english:secondary",
      "filipino:elementary",
      "filipino:secondary",
    ]);
    expect(filled(row.slots)).toHaveLength(4);
    expect(row.languages).toEqual(["english", "filipino"]);
    expect(row.completeLanguages).toEqual(["english", "filipino"]);
    expect(row.status).toBe("submitted");
  });

  it("reports a partly filed integrated school on file but not complete", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({
        is_integrated: true,
        school_papers: [
          { language: "english", level: "elementary" },
          { language: "filipino", level: "secondary" },
        ],
      }),
    ]);
    expect(filled(row.slots)).toEqual(["english:elementary", "filipino:secondary"]);
    // Both languages have a paper; neither language has both of its papers.
    expect(row.languages).toEqual(["english", "filipino"]);
    expect(row.completeLanguages).toEqual([]);
  });

  it("holds a language back from completeLanguages until both levels are filed", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({
        is_integrated: true,
        school_papers: [
          { language: "english", level: "elementary" },
          { language: "english", level: "secondary" },
          { language: "filipino", level: "elementary" },
        ],
      }),
    ]);
    expect(row.languages).toEqual(["english", "filipino"]);
    expect(row.completeLanguages).toEqual(["english"]);
  });

  it("ignores a levelled row held by a school that is not integrated", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({
        paper_participation: "undecided",
        paper_answered_at: null,
        school_papers: [{ language: "english", level: "elementary" }],
      }),
    ]);
    expect(filled(row.slots)).toEqual([]);
    expect(row.languages).toEqual([]);
    expect(row.completeLanguages).toEqual([]);
    // The stale row must not lift the school out of not-started either: it is a
    // paper the school can neither see nor edit.
    expect(row.status).toBe("incomplete");
  });

  it("ignores a whole row held by an integrated school", () => {
    const [row] = toAdminSchoolPaperRows([
      raw({
        is_integrated: true,
        paper_participation: "undecided",
        paper_answered_at: null,
        school_papers: [
          { language: "english", level: "whole" },
          { language: "filipino", level: "elementary" },
        ],
      }),
    ]);
    expect(filled(row.slots)).toEqual(["filipino:elementary"]);
    expect(row.languages).toEqual(["filipino"]);
    expect(row.completeLanguages).toEqual([]);
    expect(row.status).toBe("incomplete");
  });
});

describe("filterSchoolPaperRows", () => {
  const rows = toAdminSchoolPaperRows([
    raw({ id: "sub", name: "A", paper_participation: "yes" }),
    raw({
      id: "saved",
      name: "B",
      paper_participation: "no",
      school_papers: [{ language: "filipino", level: "whole" }],
    }),
    raw({
      id: "locked",
      name: "C",
      paper_participation: "yes",
      submission_locked_at: "2026-08-14T03:00:00.000Z",
      district_id: "d2",
      school_papers: [
        { language: "english", level: "whole" },
        { language: "filipino", level: "whole" },
      ],
    }),
    raw({
      id: "none",
      name: "D",
      paper_participation: "undecided",
      paper_answered_at: null,
      school_papers: [],
    }),
  ]);

  it("returns everything when nothing is filtered", () => {
    expect(filterSchoolPaperRows(rows, {}).map((r) => r.id)).toEqual([
      "sub",
      "saved",
      "locked",
      "none",
    ]);
  });

  it("filters by status", () => {
    expect(filterSchoolPaperRows(rows, { status: "saved" }).map((r) => r.id)).toEqual(["saved"]);
    expect(filterSchoolPaperRows(rows, { status: "incomplete" }).map((r) => r.id)).toEqual(["none"]);
  });

  it("filters by lock state in both directions", () => {
    expect(filterSchoolPaperRows(rows, { lock: "locked" }).map((r) => r.id)).toEqual(["locked"]);
    expect(filterSchoolPaperRows(rows, { lock: "unlocked" }).map((r) => r.id)).toEqual([
      "sub",
      "saved",
      "none",
    ]);
  });

  it("filters by a language being on file", () => {
    expect(filterSchoolPaperRows(rows, { language: "filipino" }).map((r) => r.id)).toEqual([
      "saved",
      "locked",
    ]);
  });

  it("filters by district and by school", () => {
    expect(filterSchoolPaperRows(rows, { district: "d2" }).map((r) => r.id)).toEqual(["locked"]);
    expect(filterSchoolPaperRows(rows, { school: "saved" }).map((r) => r.id)).toEqual(["saved"]);
  });

  it("ands multiple filters together", () => {
    expect(
      filterSchoolPaperRows(rows, { status: "submitted", lock: "unlocked" }).map((r) => r.id)
    ).toEqual(["sub"]);
  });

  it("ignores an unrecognised filter value rather than emptying the table", () => {
    expect(filterSchoolPaperRows(rows, { status: "nonsense" })).toHaveLength(4);
    expect(filterSchoolPaperRows(rows, { lock: "nonsense" })).toHaveLength(4);
  });
});

describe("filterSchoolPaperRows - language means any level", () => {
  // The bar calls this filter "Language on file (any level)", so an integrated
  // school that has filed one of its two English papers must be reachable by an
  // admin filtering for English. Half-filed is the only case that separates the
  // two readings: a school holding both papers matches under either.
  const rows = toAdminSchoolPaperRows([
    raw({
      id: "half",
      name: "A Integrated School",
      is_integrated: true,
      school_papers: [{ language: "english", level: "elementary" }],
    }),
    raw({
      id: "both",
      name: "B Integrated School",
      is_integrated: true,
      school_papers: [
        { language: "english", level: "elementary" },
        { language: "english", level: "secondary" },
      ],
    }),
    raw({
      id: "stale",
      name: "C Integrated School",
      is_integrated: true,
      school_papers: [{ language: "english", level: "whole" }],
    }),
    raw({ id: "plain", name: "D ES", school_papers: [{ language: "english", level: "whole" }] }),
  ]);

  it("matches an integrated school holding only one of its two English papers", () => {
    expect(filterSchoolPaperRows(rows, { language: "english" }).map((r) => r.id)).toEqual([
      "half",
      "both",
      "plain",
    ]);
  });

  it("does not match on a stale row that fills no slot", () => {
    expect(filterSchoolPaperRows(rows, { language: "english" }).map((r) => r.id)).not.toContain(
      "stale"
    );
  });

  it("matches nothing in a language no school has filed", () => {
    expect(filterSchoolPaperRows(rows, { language: "filipino" })).toHaveLength(0);
  });
});
