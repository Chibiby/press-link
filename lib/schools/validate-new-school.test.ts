import { describe, expect, it } from "vitest";

import { validateNewSchoolInput } from "./validate-new-school";

describe("validateNewSchoolInput", () => {
  it("trims fields and derives is_integrated/level the same way the seeder does", () => {
    const result = validateNewSchoolInput({
      name: "  Malapatan Central Elementary School  ",
      districtId: " district-1 ",
      schoolIdNumber: " 123456 ",
    });

    expect(result).toEqual({
      school: {
        name: "Malapatan Central Elementary School",
        districtId: "district-1",
        schoolIdNumber: "123456",
        isIntegrated: false,
        level: "elementary",
      },
    });
  });

  it("sets level to null for an integrated school, never a guessed level", () => {
    const result = validateNewSchoolInput({
      name: "Banlibato Integrated School",
      districtId: "district-1",
      schoolIdNumber: "123456",
    });

    expect(result).toEqual({
      school: {
        name: "Banlibato Integrated School",
        districtId: "district-1",
        schoolIdNumber: "123456",
        isIntegrated: true,
        level: null,
      },
    });
  });

  it("rejects a blank name", () => {
    expect(
      validateNewSchoolInput({ name: "   ", districtId: "d1", schoolIdNumber: "1" })
    ).toEqual({ error: "School name is required." });
  });

  it("rejects a blank district", () => {
    expect(
      validateNewSchoolInput({ name: "Some School", districtId: "  ", schoolIdNumber: "1" })
    ).toEqual({ error: "District is required." });
  });

  it("rejects a blank school ID", () => {
    expect(
      validateNewSchoolInput({ name: "Some School", districtId: "d1", schoolIdNumber: "  " })
    ).toEqual({ error: "School ID is required." });
  });

  it("rejects a non-numeric school ID, since it becomes the login password", () => {
    expect(
      validateNewSchoolInput({ name: "Some School", districtId: "d1", schoolIdNumber: "12a3" })
    ).toEqual({ error: "School ID must contain digits only." });
  });
});
