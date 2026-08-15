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
  paper_participation: "yes",
  paper_answered_at: "2026-08-14T02:00:00.000Z",
  submission_locked_at: null,
  districts: { name: "District I" },
  school_papers: [{ language: "english" }],
  ...overrides,
});

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
      raw({ school_papers: [{ language: "filipino" }, { language: "english" }] }),
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

describe("filterSchoolPaperRows", () => {
  const rows = toAdminSchoolPaperRows([
    raw({ id: "sub", name: "A", paper_participation: "yes" }),
    raw({
      id: "saved",
      name: "B",
      paper_participation: "no",
      school_papers: [{ language: "filipino" }],
    }),
    raw({
      id: "locked",
      name: "C",
      paper_participation: "yes",
      submission_locked_at: "2026-08-14T03:00:00.000Z",
      district_id: "d2",
      school_papers: [{ language: "english" }, { language: "filipino" }],
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
