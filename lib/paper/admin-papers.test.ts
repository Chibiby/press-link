import { describe, expect, it } from "vitest";

import {
  combinedPaperInfo,
  dedupedJoin,
  filterSchoolPaperRows,
  gradeLanguageSlots,
  toAdminSchoolPaperRows,
  type RawAdminSchoolPaper,
  type RawAdminSchoolPaperFile,
} from "./admin-papers";

const paperFile = (
  overrides: Partial<RawAdminSchoolPaperFile> = {}
): RawAdminSchoolPaperFile => ({
  language: "english",
  level: "whole",
  paper_name: "Sample Paper",
  adviser_name: "Adviser",
  adviser_gender: "F",
  principal_name: "Principal",
  paper_staff: [],
  ...overrides,
});

const raw = (overrides: Partial<RawAdminSchoolPaper> = {}): RawAdminSchoolPaper => ({
  id: "s1",
  name: "Bagumbayan ES",
  district_id: "d1",
  is_integrated: false,
  level: null,
  paper_participation: "yes",
  submission_locked_at: null,
  districts: { name: "District I" },
  school_papers: [paperFile()],
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
          paperFile({ language: "filipino" }),
          paperFile({ language: "english" }),
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
      raw({ paper_participation: "undecided", school_papers: [] }),
    ]);
    expect(row.status).toBe("incomplete");
    expect(row.languages).toEqual([]);
  });

  it("calls a school that answered no info-saved-only", () => {
    const [row] = toAdminSchoolPaperRows([raw({ paper_participation: "no" })]);
    expect(row.status).toBe("saved");
  });
});

describe("toAdminSchoolPaperRows - sorting", () => {
  it("sorts by district first, even when school names would sort the other way", () => {
    const rows = toAdminSchoolPaperRows([
      raw({ id: "b", name: "Aguinaldo ES", district_id: "d2", districts: { name: "District II" } }),
      raw({ id: "a", name: "Zamora ES", district_id: "d1", districts: { name: "District I" } }),
    ]);
    // "Aguinaldo" sorts before "Zamora" by name alone, but District I comes
    // first, so its school — Zamora — leads regardless of the two names.
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("sorts by school name within a district", () => {
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
        school_papers: [paperFile({ language: "english" }), paperFile({ language: "filipino" })],
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
          paperFile({ language: "english", level: "elementary" }),
          paperFile({ language: "english", level: "secondary" }),
          paperFile({ language: "filipino", level: "elementary" }),
          paperFile({ language: "filipino", level: "secondary" }),
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
          paperFile({ language: "english", level: "elementary" }),
          paperFile({ language: "filipino", level: "secondary" }),
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
          paperFile({ language: "english", level: "elementary" }),
          paperFile({ language: "english", level: "secondary" }),
          paperFile({ language: "filipino", level: "elementary" }),
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
        school_papers: [paperFile({ language: "english", level: "elementary" })],
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
        school_papers: [
          paperFile({ language: "english", level: "whole" }),
          paperFile({ language: "filipino", level: "elementary" }),
        ],
      }),
    ]);
    expect(filled(row.slots)).toEqual(["filipino:elementary"]);
    expect(row.languages).toEqual(["filipino"]);
    expect(row.completeLanguages).toEqual([]);
    expect(row.status).toBe("incomplete");
  });
});

describe("dedupedJoin", () => {
  it("returns an empty string for an empty array", () => {
    expect(dedupedJoin([])).toBe("");
  });

  it("returns an empty string when every value is blank or whitespace-only", () => {
    expect(dedupedJoin([null, undefined, "", "   "])).toBe("");
  });

  it("keeps the first occurrence of a real duplicate and drops the rest", () => {
    expect(dedupedJoin(["Juan Dela Cruz", "Maria Reyes", "Juan Dela Cruz"])).toBe(
      "Juan Dela Cruz, Maria Reyes"
    );
  });
});

describe("combinedPaperInfo", () => {
  it("lists the same adviser once when two papers share one", () => {
    const info = combinedPaperInfo(
      [
        paperFile({ language: "english", level: "elementary", adviser_name: "Juan Dela Cruz" }),
        paperFile({ language: "english", level: "secondary", adviser_name: "Juan Dela Cruz" }),
      ],
      true
    );
    expect(info.adviser).toBe("Juan Dela Cruz");
  });

  it("dedupes gender independently of adviser identity", () => {
    const info = combinedPaperInfo(
      [
        paperFile({
          language: "english",
          level: "elementary",
          adviser_name: "Juan Dela Cruz",
          adviser_gender: "M",
        }),
        paperFile({
          language: "english",
          level: "secondary",
          adviser_name: "Maria Reyes",
          adviser_gender: "F",
        }),
      ],
      true
    );
    // Two different advisers, two different genders — both survive even
    // though they are not read positionally against which adviser gave them.
    expect(info.gender).toBe("M, F");
  });

  it("leaves an empty section head from blocking assistant head or principal", () => {
    const info = combinedPaperInfo(
      [
        paperFile({
          principal_name: "Dr. Santos",
          paper_staff: [{ id: "1", full_name: "Ana Lim", title: "assistant_head" }],
        }),
      ],
      false
    );
    expect(info.sectionHead).toBe("");
    expect(info.assistantHead).toBe("Ana Lim");
    expect(info.principal).toBe("Dr. Santos");
  });

  it("lists all four advisers of an integrated school in priority order, deduped only where names repeat", () => {
    const info = combinedPaperInfo(
      [
        paperFile({ language: "filipino", level: "secondary", adviser_name: "D" }),
        paperFile({ language: "english", level: "elementary", adviser_name: "A" }),
        paperFile({ language: "english", level: "secondary", adviser_name: "C" }),
        paperFile({ language: "filipino", level: "elementary", adviser_name: "B" }),
      ],
      true
    );
    expect(info.adviser).toBe("A, B, C, D");
  });

  it("still produces real adviser, gender and principal data for a school with no grade classification", () => {
    // gradeLanguageSlots blanks the grid for a null schoolLevel, but the
    // combined names are a different question — the school did file papers.
    const info = combinedPaperInfo(
      [paperFile({ adviser_name: "Juan Dela Cruz", principal_name: "Dr. Santos" })],
      false
    );
    expect(info.adviser).toBe("Juan Dela Cruz");
    expect(info.principal).toBe("Dr. Santos");
  });

  it("drops a stale row whose level contradicts its school from every field", () => {
    const info = combinedPaperInfo(
      [paperFile({ language: "english", level: "elementary", adviser_name: "Stale Adviser" })],
      false
    );
    expect(info.adviser).toBe("");
  });
});

describe("gradeLanguageSlots", () => {
  it("returns the four cells in elementary-english, elementary-filipino, secondary-english, secondary-filipino order", () => {
    const slots = gradeLanguageSlots({
      isIntegrated: true,
      schoolLevel: null,
      savedPapers: [],
    });
    expect(slots.map((s) => `${s.level}:${s.language}`)).toEqual([
      "elementary:english",
      "elementary:filipino",
      "secondary:english",
      "secondary:filipino",
    ]);
  });

  it("titles an integrated school's slot only where a belonging paper matches level and language exactly, picking the right paper's name among several on file", () => {
    const slots = gradeLanguageSlots({
      isIntegrated: true,
      schoolLevel: null,
      savedPapers: [
        { language: "english", level: "elementary", paper_name: "The Elementary Voice" },
        { language: "english", level: "secondary", paper_name: "The Secondary Voice" },
      ],
    });
    expect(slots.filter((s) => s.title !== null)).toEqual([
      { level: "elementary", language: "english", title: "The Elementary Voice" },
      { level: "secondary", language: "english", title: "The Secondary Voice" },
    ]);
  });

  it("leaves every slot's title null for a non-integrated school with no grade classification, whatever it has on file", () => {
    const slots = gradeLanguageSlots({
      isIntegrated: false,
      schoolLevel: null,
      savedPapers: [
        { language: "english", level: "whole", paper_name: "The Whole Paper" },
        { language: "filipino", level: "whole", paper_name: "Ang Pahayagan" },
      ],
    });
    expect(slots.every((s) => s.title === null)).toBe(true);
  });

  it("titles a non-integrated school's slot for its classified level with the whole paper's name that covers that language", () => {
    const slots = gradeLanguageSlots({
      isIntegrated: false,
      schoolLevel: "elementary",
      savedPapers: [{ language: "english", level: "whole", paper_name: "The Whole Paper" }],
    });
    expect(slots.filter((s) => s.title !== null)).toEqual([
      { level: "elementary", language: "english", title: "The Whole Paper" },
    ]);
  });

  it("never titles the other level for a non-integrated school, even with a matching whole paper", () => {
    const slots = gradeLanguageSlots({
      isIntegrated: false,
      schoolLevel: "elementary",
      savedPapers: [{ language: "english", level: "whole", paper_name: "The Whole Paper" }],
    });
    expect(
      slots.find((s) => s.level === "secondary" && s.language === "english")?.title
    ).toBeNull();
  });

  it("leaves a slot's title null for a stale row that does not belong to its school per levelBelongsTo", () => {
    // A levelled row held by a non-integrated school: levelBelongsTo drops it, so
    // it cannot surface a title even though its language and level otherwise line
    // up with the grid — the same invariant paperSlots already enforces for
    // whether the paper counts as filed at all.
    const slots = gradeLanguageSlots({
      isIntegrated: false,
      schoolLevel: "elementary",
      savedPapers: [
        { language: "english", level: "elementary", paper_name: "Stale Elementary Paper" },
      ],
    });
    expect(slots.every((s) => s.title === null)).toBe(true);
  });
});

describe("filterSchoolPaperRows", () => {
  const rows = toAdminSchoolPaperRows([
    raw({ id: "sub", name: "A", paper_participation: "yes" }),
    raw({
      id: "saved",
      name: "B",
      paper_participation: "no",
      school_papers: [paperFile({ language: "filipino" })],
    }),
    raw({
      id: "locked",
      name: "C",
      paper_participation: "yes",
      submission_locked_at: "2026-08-14T03:00:00.000Z",
      district_id: "d2",
      school_papers: [paperFile({ language: "english" }), paperFile({ language: "filipino" })],
    }),
    raw({
      id: "none",
      name: "D",
      paper_participation: "undecided",
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
      school_papers: [paperFile({ language: "english", level: "elementary" })],
    }),
    raw({
      id: "both",
      name: "B Integrated School",
      is_integrated: true,
      school_papers: [
        paperFile({ language: "english", level: "elementary" }),
        paperFile({ language: "english", level: "secondary" }),
      ],
    }),
    raw({
      id: "stale",
      name: "C Integrated School",
      is_integrated: true,
      school_papers: [paperFile({ language: "english", level: "whole" })],
    }),
    raw({
      id: "plain",
      name: "D ES",
      school_papers: [paperFile({ language: "english", level: "whole" })],
    }),
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
