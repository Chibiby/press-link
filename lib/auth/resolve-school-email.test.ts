import { describe, expect, it } from "vitest";
import { resolveSchoolEmail } from "./resolve-school-email";

describe("resolveSchoolEmail", () => {
  it("builds a synthetic email from a school id number", () => {
    expect(resolveSchoolEmail("500282")).toBe("school-500282@presslink.internal");
  });
});
