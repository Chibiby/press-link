import { describe, expect, it } from "vitest";

import {
  MIN_JUDGE_PASSWORD,
  validateJudgeInput,
  validateJudgePassword,
  type JudgeInput,
} from "./judge-input";

function input(over: Partial<JudgeInput> = {}): JudgeInput {
  return {
    firstName: "Maria",
    middleName: "Reyes",
    lastName: "Santos",
    email: "maria.santos@example.com",
    affiliation: "Manila Bulletin",
    ...over,
  };
}

/** The validated judge, or a thrown assertion — so tests read without narrowing. */
function judge(over: Partial<JudgeInput> = {}) {
  const result = validateJudgeInput(input(over));
  if ("error" in result) throw new Error(`expected a judge, got: ${result.error}`);
  return result.judge;
}

function error(over: Partial<JudgeInput>): string {
  const result = validateJudgeInput(input(over));
  if (!("error" in result)) throw new Error("expected an error");
  return result.error;
}

describe("validateJudgeInput", () => {
  it("keeps a complete entry, trimmed", () => {
    expect(judge({ firstName: "  Maria  ", lastName: " Santos " })).toMatchObject({
      firstName: "Maria",
      lastName: "Santos",
    });
  });

  it("requires a first and a last name", () => {
    expect(error({ firstName: "   " })).toBe("First name is required.");
    expect(error({ lastName: "" })).toBe("Last name is required.");
  });

  it("names the first blank field, not both", () => {
    expect(error({ firstName: "", lastName: "" })).toBe("First name is required.");
  });

  it("records a blank optional field as absent rather than empty", () => {
    // `judges` distinguishes the two: no email on file means no login can be
    // provisioned, and "" would read as an address.
    expect(judge({ middleName: "  ", email: "", affiliation: "" })).toMatchObject({
      middleName: null,
      email: null,
      affiliation: null,
    });
  });

  it("lowercases the email, so two spellings of one address cannot both be on file", () => {
    expect(judge({ email: " Maria.Santos@Example.COM " }).email).toBe(
      "maria.santos@example.com",
    );
  });

  it("refuses something that is not an address", () => {
    expect(error({ email: "maria.santos" })).toBe("That does not look like an email address.");
    expect(error({ email: "maria@localhost" })).toBe(
      "That does not look like an email address.",
    );
    expect(error({ email: "maria santos@example.com" })).toBe(
      "That does not look like an email address.",
    );
  });

  it("accepts a judge with no email, who simply cannot be given a login yet", () => {
    expect(judge({ email: "" }).email).toBeNull();
  });
});

describe("validateJudgePassword", () => {
  it("accepts one at the floor", () => {
    const password = "a".repeat(MIN_JUDGE_PASSWORD);
    expect(validateJudgePassword(password)).toEqual({ password });
  });

  it("refuses one below it, and says the number", () => {
    const result = validateJudgePassword("a".repeat(MIN_JUDGE_PASSWORD - 1));
    expect(result).toEqual({
      error: `Password must be at least ${MIN_JUDGE_PASSWORD} characters.`,
    });
  });

  it("does not trim, since a space is part of a password", () => {
    // Trimming here would open an account that cannot be signed into with the
    // string the admin read out.
    expect(validateJudgePassword(" secret12 ")).toEqual({ password: " secret12 " });
  });
});
