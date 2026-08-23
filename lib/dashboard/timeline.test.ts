import { describe, expect, it } from "vitest";

import { buildTimeline, type TimelineInput } from "./timeline";
import type { SubmissionsLock, SubmissionsWrites } from "@/lib/submissions/lock-state";

/** The switch read as locked by an administrator. */
const LOCKED: SubmissionsLock = {
  state: "locked",
  at: "2026-08-12T08:31:00.000Z",
  by: null,
  byName: null,
};

/**
 * The switch that could not be read, in each of the three things that can mean.
 * The reason only changes the dialog's sentence; what the timeline may claim comes
 * from `writes`.
 */
function unreadable(writes: SubmissionsWrites): SubmissionsLock {
  return { state: "unknown", reason: "unreadable", detail: "…", writes };
}

function input(overrides: Partial<TimelineInput> = {}): TimelineInput {
  return {
    schoolsLocked: 0,
    schoolsOpenWithEntries: 0,
    entries: 0,
    submissionsLock: { state: "unlocked" },
    ...overrides,
  };
}

describe("buildTimeline", () => {
  it("returns the comp's five steps in a fixed order", () => {
    const { steps } = buildTimeline(input());
    expect(steps.map((s) => s.key)).toEqual([
      "registration",
      "judging-1",
      "judging-2",
      "tabulation",
      "results",
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      "Registration",
      "Judging Round 1",
      "Judging Round 2",
      "Tabulation",
      "Final Results",
    ]);
  });

  it("keeps registration in progress while nothing is locked", () => {
    const { steps, registration, statusPill } = buildTimeline(
      input({ schoolsLocked: 0, schoolsOpenWithEntries: 16, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(steps[0].stateLabel).toBe("IN PROGRESS");
    expect(registration).toBe("open");
    expect(statusPill).toBe("Registration Open");
  });

  it("keeps registration in progress while any school holding an entry is unlocked", () => {
    const { steps, registration } = buildTimeline(
      input({ schoolsLocked: 3, schoolsOpenWithEntries: 16, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(registration).toBe("open");
  });

  // The trap: locked schools can outnumber active ones because a school may lock
  // with zero entries. A count comparison would call this closed. It is not.
  it("does not close registration just because locked outnumbers active", () => {
    const { steps, registration, statusPill } = buildTimeline(
      input({ schoolsLocked: 20, schoolsOpenWithEntries: 3, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(registration).toBe("open");
    expect(statusPill).toBe("Registration Open");
  });

  it("closes registration once no school holding an entry is unlocked", () => {
    const { steps, registration, statusPill } = buildTimeline(
      input({ schoolsLocked: 16, schoolsOpenWithEntries: 0, entries: 41 }),
    );
    expect(steps[0].state).toBe("completed");
    expect(steps[0].stateLabel).toBe("COMPLETED");
    expect(registration).toBe("closed");
    expect(statusPill).toBe("Registration Closed");
  });

  // An empty database has nothing locked and nothing open. That is the start of
  // registration, not the end of it.
  it("treats a database with no locks at all as open", () => {
    const { steps, registration } = buildTimeline(input());
    expect(steps[0].state).toBe("in-progress");
    expect(registration).toBe("open");
  });

  it("reports locked schools and submitted entries in the registration detail", () => {
    const { steps } = buildTimeline(
      input({ schoolsLocked: 3, schoolsOpenWithEntries: 16, entries: 41 }),
    );
    expect(steps[0].detail).toBe("3 schools locked · 41 entries submitted");
  });

  it("uses singular nouns for counts of one", () => {
    const { steps } = buildTimeline(
      input({ schoolsLocked: 1, schoolsOpenWithEntries: 2, entries: 1 }),
    );
    expect(steps[0].detail).toBe("1 school locked · 1 entry submitted");
  });

  it("uses plural nouns for zero", () => {
    const { steps } = buildTimeline(input());
    expect(steps[0].detail).toBe("0 schools locked · 0 entries submitted");
  });

  it("marks the four later steps unavailable, never pending", () => {
    const { steps } = buildTimeline(
      input({ schoolsLocked: 16, schoolsOpenWithEntries: 0, entries: 41 }),
    );
    for (const step of steps.slice(1)) {
      expect(step.state).toBe("unavailable");
      expect(step.stateLabel).toBe("Not yet available");
    }
    expect(steps.map((s) => s.stateLabel)).not.toContain("PENDING");
  });

  it("says what each unavailable step is waiting for", () => {
    const { steps } = buildTimeline(input());
    for (const step of steps) {
      expect(step.detail.length).toBeGreaterThan(0);
    }
    expect(steps[1].detail).toContain("judge accounts");
    expect(steps[3].detail).toContain("scores");
  });

  // Closing registration must not imply the pipeline behind it has started.
  it("leaves the later steps unavailable regardless of registration state", () => {
    const open = buildTimeline(input({ schoolsOpenWithEntries: 16, entries: 41 }));
    const closed = buildTimeline(input({ schoolsLocked: 16, entries: 41 }));
    expect(open.steps.slice(1)).toEqual(closed.steps.slice(1));
  });
});

describe("buildTimeline with the division-wide lock", () => {
  // The whole point of the flag reaching this function. Without it the dashboard
  // reads "Registration Open" while not one school in the division can save
  // anything.
  it("closes registration on the switch alone, with nothing locked per school", () => {
    const { steps, registration, statusPill } = buildTimeline(
      input({
        submissionsLock: LOCKED,
        schoolsLocked: 0,
        schoolsOpenWithEntries: 16,
        entries: 41,
      }),
    );
    expect(steps[0].state).toBe("completed");
    expect(steps[0].stateLabel).toBe("COMPLETED");
    expect(registration).toBe("closed");
    expect(statusPill).toBe("Registration Closed");
  });

  // Same shape as the "locked outnumbers active" trap above, which stays open
  // while the switch is off and must close while it is on.
  it("overrides the per-school counts rather than being weighed against them", () => {
    const counts = { schoolsLocked: 20, schoolsOpenWithEntries: 3, entries: 41 };
    expect(buildTimeline(input({ ...counts })).registration).toBe("open");
    expect(
      buildTimeline(input({ ...counts, submissionsLock: LOCKED })).registration,
    ).toBe("closed");
  });

  // Reversibility, which is the design of the switch: it writes nothing to
  // `schools`, so turning it off must return exactly the previous answer.
  it("returns to the per-school answer when the switch goes off", () => {
    const counts = { schoolsLocked: 3, schoolsOpenWithEntries: 16, entries: 41 };
    const on = buildTimeline(input({ ...counts, submissionsLock: LOCKED }));
    const off = buildTimeline(input({ ...counts, submissionsLock: { state: "unlocked" } }));
    expect(on.registration).toBe("closed");
    expect(off.registration).toBe("open");
    expect(off.statusPill).toBe("Registration Open");
    // Not merely open again — identical, step details included.
    expect(off).toEqual(buildTimeline(input(counts)));
  });

  // The counts stay: they are what says how much reopening would let back in.
  it("adds the switch to the registration detail without dropping the counts", () => {
    const { steps } = buildTimeline(
      input({ submissionsLock: LOCKED, schoolsLocked: 3, entries: 41 }),
    );
    expect(steps[0].detail).toBe(
      "3 schools locked · 41 entries submitted · locked division-wide",
    );
  });

  it("says nothing about the switch while it is off", () => {
    const { steps } = buildTimeline(input({ schoolsLocked: 3, entries: 41 }));
    expect(steps[0].detail).toBe("3 schools locked · 41 entries submitted");
    expect(steps[0].detail).not.toContain("division-wide");
  });

  it("leaves the later steps unavailable while the switch is on", () => {
    const { steps } = buildTimeline(
      input({ submissionsLock: LOCKED, entries: 41 }),
    );
    for (const step of steps.slice(1)) {
      expect(step.state).toBe("unavailable");
      expect(step.stateLabel).toBe("Not yet available");
    }
  });
});

describe("buildTimeline when the switch could not be read", () => {
  // A guard standing over a flag it cannot read refuses every school-side save, so
  // registration really is shut — but nobody locked anything, and the old copy said
  // "locked division-wide" beside a header reading "Lock state unknown".
  it("closes registration for refused writes without claiming an admin locked it", () => {
    const { steps, registration, statusPill } = buildTimeline(
      input({
        submissionsLock: unreadable("refused"),
        schoolsLocked: 3,
        schoolsOpenWithEntries: 16,
        entries: 41,
      }),
    );
    expect(registration).toBe("closed");
    expect(statusPill).toBe("Registration Closed");
    expect(steps[0].detail).toBe(
      "3 schools locked · 41 entries submitted · division-wide saves refused: lock state unreadable",
    );
    expect(steps[0].detail).not.toContain("locked division-wide");
  });

  // The live bug. A statement timeout, an expired JWT or a `fetch` that never
  // landed arrives here as "undetermined", and the dashboard used to answer it with
  // "Registration Closed" over a production database where 0022 is not applied and
  // every school could save.
  it("asserts neither state when nothing was established", () => {
    const { steps, registration, statusPill } = buildTimeline(
      input({
        submissionsLock: unreadable("undetermined"),
        schoolsLocked: 3,
        schoolsOpenWithEntries: 16,
        entries: 41,
      }),
    );
    expect(registration).toBe("unknown");
    expect(statusPill).toBe("Registration state unknown");
    expect(steps[0].state).toBe("unknown");
    expect(steps[0].stateLabel).toBe("STATE UNKNOWN");
    expect(steps[0].detail).toBe(
      "3 schools locked · 41 entries submitted · division-wide lock state could not be read",
    );
    // Neither of the two confident answers, in either direction.
    expect(statusPill).not.toBe("Registration Closed");
    expect(statusPill).not.toBe("Registration Open");
    expect(steps[0].detail).not.toContain("locked division-wide");
  });

  // The counts are evidence of their own, and they outrank a reading that failed:
  // every school holding an entry has locked itself, so registration is finished
  // whatever the switch would have said.
  it("still closes registration on the counts alone while the switch is unreadable", () => {
    const { registration, statusPill } = buildTimeline(
      input({
        submissionsLock: unreadable("undetermined"),
        schoolsLocked: 16,
        schoolsOpenWithEntries: 0,
        entries: 41,
      }),
    );
    expect(registration).toBe("closed");
    expect(statusPill).toBe("Registration Closed");
  });

  // The pre-migration read: the error codes say the switch is not installed, so
  // nothing consults a flag and this is the open division it has always been.
  it("renders an absent switch exactly as an open one", () => {
    const counts = { schoolsLocked: 3, schoolsOpenWithEntries: 16, entries: 41 };
    expect(buildTimeline(input({ ...counts, submissionsLock: unreadable("open") }))).toEqual(
      buildTimeline(input(counts)),
    );
  });

  it("leaves the later steps unavailable while the switch is unreadable", () => {
    for (const writes of ["refused", "open", "undetermined"] as const) {
      const { steps } = buildTimeline(
        input({ submissionsLock: unreadable(writes), entries: 41 }),
      );
      for (const step of steps.slice(1)) {
        expect(step.state, writes).toBe("unavailable");
        expect(step.stateLabel, writes).toBe("Not yet available");
      }
    }
  });
});
