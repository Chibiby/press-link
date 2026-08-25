import { describe, expect, it } from "vitest";
import { transformSchoolRows, type RawSchoolRow } from "./districts-schools.transform";

describe("transformSchoolRows", () => {
  it("normalizes valid rows and dedupes/trims districts", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "500282", schoolName: "Alabel Integrated SPED Center", district: "Alabel 1" },
      { schoolId: "500289", schoolName: "Banlibato Integrated School", district: "Alabel 1 " },
      { schoolId: 130425, schoolName: "Famorcan ES", district: " Alabel 1" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.districtNames).toEqual(["Alabel 1"]);
    expect(result.schools).toHaveLength(3);
    expect(result.schools[0]).toEqual({
      schoolIdNumber: "500282",
      schoolName: "Alabel Integrated SPED Center",
      districtName: "Alabel 1",
      isIntegrated: true,
      level: null,
    });
  });

  it("skips section-banner rows with no school id", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: undefined, schoolName: "ALABEL 1 DISTRICT", district: undefined },
      { schoolId: "500282", schoolName: "Alabel Integrated SPED Center", district: "Alabel 1" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools).toHaveLength(1);
    expect(result.districtNames).toEqual(["Alabel 1"]);
  });

  it("skips rows missing a school name or district", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "999999", schoolName: "", district: "Alabel 1" },
      { schoolId: "999998", schoolName: "No District School", district: "" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools).toHaveLength(0);
  });

  it("keeps the first row and skips later rows that repeat a school id", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "130551", schoolName: "Del Hilado ES", district: "Malapatan 2" },
      { schoolId: "130551", schoolName: "Del Hilado ES (Matlusi Extension)", district: "Malapatan 2" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools).toHaveLength(1);
    expect(result.schools[0].schoolName).toBe("Del Hilado ES");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      schoolName: "Del Hilado ES (Matlusi Extension)",
      reason: "duplicate-school-id",
    });
  });

  it("skips rows with a placeholder (non-numeric) school id", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "No School ID yet", schoolName: "Datal Bong ES - Green Valley extension", district: "Kiamba 1" },
      { schoolId: "130506", schoolName: "Mamangos Maulana Kandog ES", district: "Kiamba 1" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools).toHaveLength(1);
    expect(result.schools[0].schoolName).toBe("Mamangos Maulana Kandog ES");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      schoolName: "Datal Bong ES - Green Valley extension",
      rawSchoolId: "No School ID yet",
      reason: "non-numeric-school-id",
    });
  });

  // A fresh environment has to end up with the same `is_integrated` values that
  // migration 0016 backfills into an existing one, or the two diverge on day one.
  // Both names below are real rows from the division roll.
  it("flags integrated schools from the name, and only those", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "500282", schoolName: "Alabel Integrated SPED Center", district: "Alabel 1" },
      { schoolId: "500289", schoolName: "Banlibato Integrated School", district: "Alabel 1" },
      { schoolId: "130425", schoolName: "Famorcan ES", district: "Alabel 1" },
      { schoolId: "130551", schoolName: "Del Hilado ES", district: "Malapatan 2" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools.map((s) => [s.schoolName, s.isIntegrated])).toEqual([
      ["Alabel Integrated SPED Center", true],
      ["Banlibato Integrated School", true],
      ["Famorcan ES", false],
      ["Del Hilado ES", false],
    ]);
  });

  // Word boundaries, not a substring — the same predicate the migration spells as
  // `name ~* '\yintegrated\y'`. A school called "Reintegrated" is not integrated.
  it("does not flag a school whose name merely contains the letters", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "111111", schoolName: "Reintegrated Learning Center", district: "Alabel 1" },
      { schoolId: "222222", schoolName: "Malapatan INTEGRATED School", district: "Malapatan 2" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools[0].isIntegrated).toBe(false);
    // Case-insensitive, so the roll's shouty spellings are caught too.
    expect(result.schools[1].isIntegrated).toBe(true);
  });

  // A fresh environment has to end up with the same `level` values that migration
  // 0026 backfills into an existing one, or the two diverge on day one — same
  // reasoning as the `isIntegrated` tests above.
  it("infers a level from the name for non-integrated schools only", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "130425", schoolName: "Malapatan Central Elementary School", district: "Alabel 1" },
      { schoolId: "130551", schoolName: "Alabel National High School", district: "Alabel 1" },
      { schoolId: "130552", schoolName: "Famorcan ES", district: "Alabel 1" },
      { schoolId: "500289", schoolName: "Banlibato Integrated School", district: "Alabel 1" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools.map((s) => [s.schoolName, s.isIntegrated, s.level])).toEqual([
      ["Malapatan Central Elementary School", false, "elementary"],
      ["Alabel National High School", false, "secondary"],
      // "ES" is not the word "elementary", so this stays unclassified rather than guessed.
      ["Famorcan ES", false, null],
      // Integrated: never classified into a level, no matter what the name says.
      ["Banlibato Integrated School", true, null],
    ]);
  });
});
