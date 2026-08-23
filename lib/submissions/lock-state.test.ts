import { describe, expect, it } from "vitest";

import {
  describeLockStamp,
  formatLockedAt,
  submissionsLockControl,
  type SubmissionsLock,
} from "./lock-state";

/** 12 August 2026, 16:31 Manila time, written as the UTC instant Postgres returns. */
const LOCKED_AT = "2026-08-12T08:31:00.000Z";

type LockedState = Extract<SubmissionsLock, { state: "locked" }>;

function locked(overrides: Partial<LockedState> = {}): LockedState {
  return { state: "locked", at: LOCKED_AT, by: null, byName: null, ...overrides };
}

/**
 * ICU emits a narrow no-break space before AM/PM on some builds and an ordinary
 * space on others, which is invisible in a diff and not what any of these tests
 * are about.
 */
function plain(value: string | null): string | null {
  return value === null ? null : value.replace(/[  ]/g, " ");
}

describe("formatLockedAt", () => {
  // The bug this guards: a UTC server printing 12 August for an instant that is
  // already 13 August in the division office, or the reverse.
  it("formats in division time, not the runtime's timezone", () => {
    expect(formatLockedAt(LOCKED_AT)).toContain("August 12, 2026");
    expect(formatLockedAt(LOCKED_AT)).toContain("4:31");
  });

  // 16:31 UTC on the 12th is 00:31 on the 13th in Manila.
  it("rolls the date over at Manila midnight, not UTC midnight", () => {
    expect(formatLockedAt("2026-08-12T16:31:00.000Z")).toContain("August 13, 2026");
  });

  it("returns null when there is no stamp", () => {
    expect(formatLockedAt(null)).toBeNull();
    expect(formatLockedAt(undefined)).toBeNull();
    expect(formatLockedAt("")).toBeNull();
  });

  it("returns null rather than 'Invalid Date' for unparseable input", () => {
    expect(formatLockedAt("not a timestamp")).toBeNull();
  });
});

describe("describeLockStamp", () => {
  it("names the admin when the name resolved", () => {
    expect(plain(describeLockStamp(locked({ by: "u-1", byName: "Hugo Soliza" })))).toBe(
      "Locked since August 12, 2026 at 4:31 PM by Hugo Soliza.",
    );
  });

  // admin_profiles is self-read under RLS, so a lock set by a different admin
  // arrives as a uuid with no name. A raw uuid on screen would be worse than
  // this.
  it("stays generic when only the uuid is known", () => {
    const line = describeLockStamp(locked({ by: "u-2", byName: null }));
    expect(line).toContain("by another administrator");
    expect(line).not.toContain("u-2");
  });

  // 0022 leaves submissions_locked_by null when a script or migration flipped
  // the switch with no auth.uid() to attribute it to.
  it("says so when nobody is recorded", () => {
    expect(plain(describeLockStamp(locked({ by: null, byName: null })))).toBe(
      "Locked since August 12, 2026 at 4:31 PM, with no administrator recorded against it.",
    );
  });

  it("does not invent a time when the stamp is missing", () => {
    const line = describeLockStamp(locked({ at: null }));
    expect(line).toBe("Locked division-wide, with no time recorded against it.");
    expect(line).not.toContain("Invalid");
  });

  it("has nothing to attribute when the division is open or unreadable", () => {
    expect(describeLockStamp({ state: "unlocked" })).toBeNull();
    expect(
      describeLockStamp({ state: "unknown", reason: "no-row", detail: "no row" }),
    ).toBeNull();
  });
});

describe("submissionsLockControl", () => {
  it("offers the lock as a quiet errand while submissions are open", () => {
    const control = submissionsLockControl({ state: "unlocked" });
    expect(control.label).toBe("Lock submissions");
    expect(control.variant).toBe("outline");
    expect(control.nextLocked).toBe(true);
    // Freezing the division is what the destructive styling is for, and it
    // belongs on the click that does it.
    expect(control.confirmVariant).toBe("destructive");
  });

  it("reports the frozen state destructively, and offers the way out", () => {
    const control = submissionsLockControl(locked());
    expect(control.label).toBe("Submissions locked");
    expect(control.variant).toBe("destructive");
    expect(control.nextLocked).toBe(false);
    expect(control.title).toBe("Unlock submissions division-wide?");
    expect(control.confirmLabel).toBe("Unlock submissions");
    // Unlocking restores every school to its own lock. Nothing is destroyed.
    expect(control.confirmVariant).toBe("default");
  });

  // The state that must never look like "open": a missing settings row is
  // refusing every school-side write right now.
  it("does not present an unreadable flag as either locked or open", () => {
    for (const reason of ["no-row", "unreadable"] as const) {
      const control = submissionsLockControl({ state: "unknown", reason, detail: "…" });
      expect(control.label).toBe("Lock state unknown");
      expect(control.icon).toBe("alert");
      // Restoring the row must not freeze a division that was never frozen.
      expect(control.nextLocked).toBe(false);
    }
  });

  it("never leaves the two live states looking alike", () => {
    const open = submissionsLockControl({ state: "unlocked" });
    const shut = submissionsLockControl(locked());
    expect(open.label).not.toBe(shut.label);
    expect(open.variant).not.toBe(shut.variant);
    expect(open.nextLocked).not.toBe(shut.nextLocked);
  });
});
