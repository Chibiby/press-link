import { describe, expect, it } from "vitest";

import { buildTimeline, type TimelineInput } from "./timeline";

function input(overrides: Partial<TimelineInput> = {}): TimelineInput {
  return { schoolsLocked: 0, schoolsOpenWithEntries: 0, entries: 0, ...overrides };
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
    const { steps, registrationClosed, statusPill } = buildTimeline(
      input({ schoolsLocked: 0, schoolsOpenWithEntries: 16, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(steps[0].stateLabel).toBe("IN PROGRESS");
    expect(registrationClosed).toBe(false);
    expect(statusPill).toBe("Registration Open");
  });

  it("keeps registration in progress while any school holding an entry is unlocked", () => {
    const { steps, registrationClosed } = buildTimeline(
      input({ schoolsLocked: 3, schoolsOpenWithEntries: 16, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(registrationClosed).toBe(false);
  });

  // The trap: locked schools can outnumber active ones because a school may lock
  // with zero entries. A count comparison would call this closed. It is not.
  it("does not close registration just because locked outnumbers active", () => {
    const { steps, registrationClosed, statusPill } = buildTimeline(
      input({ schoolsLocked: 20, schoolsOpenWithEntries: 3, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(registrationClosed).toBe(false);
    expect(statusPill).toBe("Registration Open");
  });

  it("closes registration once no school holding an entry is unlocked", () => {
    const { steps, registrationClosed, statusPill } = buildTimeline(
      input({ schoolsLocked: 16, schoolsOpenWithEntries: 0, entries: 41 }),
    );
    expect(steps[0].state).toBe("completed");
    expect(steps[0].stateLabel).toBe("COMPLETED");
    expect(registrationClosed).toBe(true);
    expect(statusPill).toBe("Registration Closed");
  });

  // An empty database has nothing locked and nothing open. That is the start of
  // registration, not the end of it.
  it("treats a database with no locks at all as open", () => {
    const { steps, registrationClosed } = buildTimeline(input());
    expect(steps[0].state).toBe("in-progress");
    expect(registrationClosed).toBe(false);
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
