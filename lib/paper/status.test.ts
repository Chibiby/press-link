import { describe, expect, it } from "vitest";

import { PAPER_STATUS_LABEL, paperStatus } from "./status";

describe("paperStatus", () => {
  it("is incomplete before anything is saved", () => {
    expect(paperStatus({ participation: "undecided", paperCount: 0, lockedAt: null })).toBe(
      "incomplete"
    );
  });

  it("is still incomplete once saved but not yet answered", () => {
    expect(paperStatus({ participation: "undecided", paperCount: 2, lockedAt: null })).toBe(
      "incomplete"
    );
  });

  it("is saved when the school answered no", () => {
    expect(paperStatus({ participation: "no", paperCount: 1, lockedAt: null })).toBe("saved");
  });

  it("is submitted when the school answered yes", () => {
    expect(paperStatus({ participation: "yes", paperCount: 1, lockedAt: null })).toBe("submitted");
  });

  it("trusts a locked school's answer even with no paper rows left", () => {
    expect(
      paperStatus({ participation: "yes", paperCount: 0, lockedAt: "2026-08-14T02:00:00.000Z" })
    ).toBe("submitted");
  });

  it("trusts a locked school's no even with no paper rows left", () => {
    expect(
      paperStatus({ participation: "no", paperCount: 0, lockedAt: "2026-08-14T02:00:00.000Z" })
    ).toBe("saved");
  });

  it("falls back to incomplete when an answer has lost its papers", () => {
    expect(paperStatus({ participation: "yes", paperCount: 0, lockedAt: null })).toBe("incomplete");
  });

  it("spells each state the way the spec does", () => {
    expect(PAPER_STATUS_LABEL.incomplete).toBe("Not started");
    expect(PAPER_STATUS_LABEL.saved).toBe("Info saved only");
    expect(PAPER_STATUS_LABEL.submitted).toBe("Submitted to contest");
  });
});
