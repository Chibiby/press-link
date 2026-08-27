import { describe, expect, it } from "vitest";

import { eventControl, eventControls, type EventControlFacts } from "./event-controls";
import type { EventJudgingStatus } from "./types";

const ALL_STATUSES: EventJudgingStatus[] = [
  "not-started",
  "round1-open",
  "round1-awaiting-close",
  "round2-open",
  "round2-awaiting-lock",
  "locked",
];

function facts(over: Partial<EventControlFacts> = {}): EventControlFacts {
  return { status: "round1-open", round2Cut: 10, individual: true, ...over };
}

/** The statuses in which the given control may be pressed. */
function enabledStatuses(
  id: Parameters<typeof eventControl>[1],
  over: Partial<EventControlFacts> = {},
): EventJudgingStatus[] {
  return ALL_STATUSES.filter(
    (status) => eventControl(facts({ ...over, status }), id).disabledReason === null,
  );
}

describe("eventControls", () => {
  it("offers all six controls in every state, so the console does not change shape", () => {
    for (const status of ALL_STATUSES) {
      expect(eventControls(facts({ status })).map((control) => control.id)).toEqual([
        "set-cut",
        "lock-round1",
        "unlock-round1",
        "lock-results",
        "unlock-results",
      ]);
    }
  });

  it("refuses every control on a group event, which has no two-stage rounds", () => {
    for (const status of ALL_STATUSES) {
      const controls = eventControls(facts({ status, individual: false }));
      expect(controls.every((control) => control.disabledReason !== null)).toBe(true);
      for (const control of controls) {
        expect(control.disabledReason).toContain("group event");
      }
    }
  });

  it("always gives a sentence with a disabled control, never a bare flag", () => {
    for (const status of ALL_STATUSES) {
      for (const control of eventControls(facts({ status, round2Cut: null }))) {
        if (control.disabledReason !== null) {
          expect(control.disabledReason.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("the round 2 cut", () => {
  it("may be set until somebody has ranked against it", () => {
    expect(enabledStatuses("set-cut")).toEqual(["not-started", "round1-open"]);
  });

  it("is refused the moment round 1's sheet lands, before the round is closed", () => {
    // The hole migration 0030 closed: locking used to be the test, so in the
    // window between seat 1 submitting and an admin closing the round, the cut
    // could drop under ranks already made against the old number.
    const reason = eventControl(
      facts({ status: "round1-awaiting-close" }),
      "set-cut"
    ).disabledReason;
    expect(reason).toContain("ranked against this cut");
  });

  it("is refused once a qualifier list has been drawn under it, and says both steps", () => {
    const reason = eventControl(facts({ status: "round2-open" }), "set-cut").disabledReason;
    expect(reason).toContain("Reopen round 1");
    expect(reason).toContain("sheet");
  });

  it("may still be set on an event that has none on file", () => {
    expect(enabledStatuses("set-cut", { round2Cut: null })).toEqual([
      "not-started",
      "round1-open",
    ]);
  });
});

describe("closing round 1", () => {
  it("waits for the one judge's sheet, and is offered the moment it lands", () => {
    expect(enabledStatuses("lock-round1")).toEqual(["round1-awaiting-close"]);
  });

  it("names the outstanding judge while the round is still open", () => {
    expect(
      eventControl(facts({ status: "round1-open" }), "lock-round1").disabledReason,
    ).toContain("has not submitted");
  });

  it("is refused with no cut on file, since there is no field to draw", () => {
    expect(enabledStatuses("lock-round1", { round2Cut: null })).toEqual([]);
    expect(
      eventControl(facts({ status: "round1-awaiting-close", round2Cut: null }), "lock-round1")
        .disabledReason,
    ).toContain("no round 2 cut on file");
  });

  it("tells a mid-round event about the judge rather than about the missing cut", () => {
    // The cut can still be set before the sheet lands, so the outstanding judge
    // is the fact worth reporting.
    expect(
      eventControl(facts({ status: "round1-open", round2Cut: null }), "lock-round1")
        .disabledReason,
    ).toContain("has not submitted");
  });

  it("reports an already-closed round as closed, not as awaiting a judge", () => {
    for (const status of ["round2-open", "round2-awaiting-lock", "locked"] as const) {
      expect(eventControl(facts({ status }), "lock-round1").disabledReason).toBe(
        "Round 1 is already closed.",
      );
    }
  });
});

describe("reopening round 1", () => {
  it("is offered once round 1 is closed and before the results are published", () => {
    expect(enabledStatuses("unlock-round1")).toEqual(["round2-open", "round2-awaiting-lock"]);
  });

  it("is refused under published results, so no unlock contradicts a standing", () => {
    expect(eventControl(facts({ status: "locked" }), "unlock-round1").disabledReason).toContain(
      "Unlock the results first",
    );
  });

  it("is refused before round 1 has been closed at all", () => {
    expect(
      eventControl(facts({ status: "round1-awaiting-close" }), "unlock-round1").disabledReason,
    ).toBe("Round 1 is not closed yet.");
  });
});

describe("publishing the results", () => {
  it("waits for round 2 to be complete", () => {
    expect(enabledStatuses("lock-results")).toEqual(["round2-awaiting-lock"]);
  });

  it("reports an already-published event as published", () => {
    expect(eventControl(facts({ status: "locked" }), "lock-results").disabledReason).toBe(
      "The results are already published.",
    );
  });

  it("unlocks only what is published", () => {
    expect(enabledStatuses("unlock-results")).toEqual(["locked"]);
  });

  it("never offers the lock and the unlock at the same time", () => {
    for (const status of ALL_STATUSES) {
      const state = facts({ status });
      const both =
        eventControl(state, "lock-results").disabledReason === null &&
        eventControl(state, "unlock-results").disabledReason === null;
      expect(both).toBe(false);
    }
  });
});
