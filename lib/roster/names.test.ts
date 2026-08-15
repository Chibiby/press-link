import { describe, expect, it } from "vitest";

import { surnameFirst } from "./names";

describe("surnameFirst", () => {
  it("puts the surname first, then the given names", () => {
    expect(
      surnameFirst({ first_name: "Ana", middle_name: "Mercado", last_name: "Dela Cruz" })
    ).toBe("Dela Cruz, Ana Mercado");
  });

  it("omits the middle name when there is none", () => {
    expect(surnameFirst({ first_name: "Ana", middle_name: null, last_name: "Dela Cruz" })).toBe(
      "Dela Cruz, Ana"
    );
  });

  it("treats an empty middle name as absent", () => {
    expect(surnameFirst({ first_name: "Ana", middle_name: "", last_name: "Dela Cruz" })).toBe(
      "Dela Cruz, Ana"
    );
  });

  it("leaves no dangling comma when only a surname is on file", () => {
    expect(surnameFirst({ first_name: "", middle_name: null, last_name: "Dela Cruz" })).toBe(
      "Dela Cruz"
    );
  });

  it("leaves no dangling comma when only given names are on file", () => {
    expect(surnameFirst({ first_name: "Ana", middle_name: null, last_name: "" })).toBe("Ana");
  });

  it("returns an empty string when nothing is on file", () => {
    expect(surnameFirst({ first_name: "", middle_name: null, last_name: "" })).toBe("");
  });
});
