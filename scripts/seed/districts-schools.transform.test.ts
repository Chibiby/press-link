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

  it("keeps the first row and drops later rows that repeat a school id", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "130551", schoolName: "Del Hilado ES", district: "Malapatan 2" },
      { schoolId: "130551", schoolName: "Del Hilado ES (Matlusi Extension)", district: "Malapatan 2" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools).toHaveLength(1);
    expect(result.schools[0].schoolName).toBe("Del Hilado ES");
    expect(result.droppedDuplicates).toHaveLength(1);
    expect(result.droppedDuplicates[0].schoolName).toBe("Del Hilado ES (Matlusi Extension)");
  });
});
