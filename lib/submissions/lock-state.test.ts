import { describe, expect, it } from "vitest";

import {
  describeLockStamp,
  describeUnknownLock,
  formatLockedAt,
  isMissingLockGuard,
  submissionsLockControl,
  submissionsWrites,
  writesAfterFailedLockRead,
  type SubmissionsLock,
  type SubmissionsLockUnknown,
} from "./lock-state";

/** 12 August 2026, 16:31 Manila time, written as the UTC instant Postgres returns. */
const LOCKED_AT = "2026-08-12T08:31:00.000Z";

type LockedState = Extract<SubmissionsLock, { state: "locked" }>;

function locked(overrides: Partial<LockedState> = {}): LockedState {
  return { state: "locked", at: LOCKED_AT, by: null, byName: null, ...overrides };
}

/**
 * An unknown state. `writes` defaults to "refused" because that is the case the
 * copy has to be most careful about: the guard is standing over a flag it cannot
 * read, so it raises and every school-side save is refused. The other two are
 * passed explicitly wherever they matter.
 */
function unknown(
  overrides: Partial<SubmissionsLockUnknown> & { reason: SubmissionsLockUnknown["reason"] },
): SubmissionsLockUnknown {
  return { state: "unknown", detail: "…", writes: "refused", ...overrides };
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
    expect(describeLockStamp(unknown({ reason: "no-row" }))).toBeNull();
  });
});

describe("isMissingLockGuard", () => {
  // The two dialects for the same condition. A Supabase project answers from its
  // schema cache and never reaches Postgres; a direct statement returns the
  // SQLSTATE. Both mean 0022 is not here.
  it("recognises an absent table, function or column in either dialect", () => {
    for (const code of [
      "42P01",
      "42883",
      "42703",
      "PGRST205",
      "PGRST202",
      "PGRST204",
    ]) {
      expect(isMissingLockGuard(code), code).toBe(true);
    }
  });

  // The whole point of reading the code rather than the message: everything else
  // leaves the guard standing, and the guard fails closed.
  it("does not mistake any other failure for a missing switch", () => {
    for (const code of ["", "PGRST301", "57014", "42501", "23514", "PGRST116"]) {
      expect(isMissingLockGuard(code), code).toBe(false);
    }
    expect(isMissingLockGuard(null)).toBe(false);
    expect(isMissingLockGuard(undefined)).toBe(false);
  });
});

describe("writesAfterFailedLockRead", () => {
  // The one failure that positively establishes an open division: the switch's own
  // table, function or column reporting itself absent. Nothing consults a flag on
  // such a database.
  it("reads an absent switch as writes going through", () => {
    for (const code of [
      "42P01",
      "42883",
      "42703",
      "PGRST205",
      "PGRST202",
      "PGRST204",
    ]) {
      expect(writesAfterFailedLockRead(code), code).toBe("open");
    }
  });

  // Postgres raising over objects that exist: 0022 is installed, the flag could
  // not be read, and `submissions_locked_globally()` answers that by raising
  // rather than returning false.
  it("reads a raise from Postgres over an existing switch as writes refused", () => {
    // 42501 insufficient_privilege, P0001 raise_exception, 22023 invalid_parameter.
    for (const code of ["42501", "P0001", "22023"]) {
      expect(writesAfterFailedLockRead(code), code).toBe("refused");
    }
  });

  // The live defect. Every one of these used to answer "refused", so a dashboard
  // reading a production database with no 0022 on it printed "Registration Closed"
  // over a division where every school could save.
  it("establishes nothing from a failure that never reached the flag", () => {
    for (const code of [
      "PGRST301", // expired JWT — PostgREST refused before Postgres saw anything
      "PGRST100", // any other PostgREST answer
      "57014", // statement timeout
      "57P03", // cannot_connect_now
      "08006", // connection_failure
      "53300", // too_many_connections
      "XX000", // internal_error
      "500", // a proxy status where a code was expected
      "", // an error object with no code at all
    ]) {
      expect(writesAfterFailedLockRead(code), code).toBe("undetermined");
    }
    // A network failure: `fetch` rejected and there is no code to read.
    expect(writesAfterFailedLockRead(null)).toBe("undetermined");
    expect(writesAfterFailedLockRead(undefined)).toBe("undetermined");
  });
});

describe("submissionsWrites", () => {
  it("is refused while the flag reads locked and open while it reads open", () => {
    expect(submissionsWrites(locked())).toBe("refused");
    expect(submissionsWrites({ state: "unlocked" })).toBe("open");
  });

  // The defect this exists for: `state === "locked"` answered false for an
  // unknown flag, and the dashboard printed "Registration Open" over a division
  // in which every school-side write was being refused.
  it("carries a missing settings row through as refused", () => {
    expect(submissionsWrites(unknown({ reason: "no-row" }))).toBe("refused");
  });

  // The sole open case among the unknowns, and it is not a guess: an absent table
  // has no trigger behind it, so nothing consults a flag and every school can save.
  it("leaves writes open where the switch is not installed at all", () => {
    expect(submissionsWrites(unknown({ reason: "unreadable", writes: "open" }))).toBe(
      "open",
    );
  });

  // The third answer, which is the whole point: it must not collapse into either
  // of the other two on its way to the pill.
  it("passes an undetermined read on undetermined", () => {
    expect(
      submissionsWrites(unknown({ reason: "unreadable", writes: "undetermined" })),
    ).toBe("undetermined");
    expect(submissionsWrites(unknown({ reason: "unusable-flag", writes: "undetermined" }))).toBe(
      "undetermined",
    );
  });
});

describe("describeUnknownLock", () => {
  it("says the row is missing and that the repair is below", () => {
    const line = describeUnknownLock(unknown({ reason: "no-row" }));
    expect(line).toContain("being refused");
    expect(line).toContain("puts the row back");
  });

  // The copy defect: a transient failure over a genuinely locked division used to
  // read "nothing is frozen and every school can save as usual".
  it("never claims the division is open on a failed read", () => {
    const line = describeUnknownLock(unknown({ reason: "unreadable" }));
    expect(line).toContain("cannot be read");
    expect(line).not.toContain("as usual");
    expect(line).not.toContain("nothing is frozen");
  });

  // Where the codes say the switch is absent, saying so is not a guess — and it
  // is the state every un-migrated environment is in.
  it("says saves are unaffected only where the switch is absent", () => {
    const line = describeUnknownLock(unknown({ reason: "unreadable", writes: "open" }));
    expect(line).toContain("going through as usual");
    expect(line).toContain("0022");
  });

  // The live defect, in copy: a timeout or an expired session got the sentence
  // written for a standing guard, so an admin was told the division was frozen on
  // no evidence at all.
  it("claims neither state when the failure established nothing", () => {
    const line = describeUnknownLock(
      unknown({ reason: "unreadable", writes: "undetermined" }),
    );
    expect(line).toContain("cannot tell you which state the division is in");
    // Not the standing-guard sentence, and not the absent-switch one either.
    expect(line).not.toContain("whichever way");
    expect(line).not.toContain("going through as usual");
    // And it says why an unknown here is not a lock failing open: this panel
    // reports, the triggers enforce.
    expect(line).toContain("the guards in the database");
  });

  it("names the flag itself when the row is there but unusable", () => {
    const line = describeUnknownLock(
      unknown({ reason: "unusable-flag", writes: "undetermined" }),
    );
    expect(line).toContain("neither true nor false");
    expect(line).not.toContain("going through as usual");
  });
});

describe("submissionsLockControl", () => {
  it("offers the lock as a quiet errand while submissions are open", () => {
    const control = submissionsLockControl({ state: "unlocked" });
    expect(control.label).toBe("Lock submissions");
    expect(control.variant).toBe("outline");
    expect(control.actions.map((a) => a.nextLocked)).toEqual([true]);
    // Freezing the division is what the destructive styling is for, and it
    // belongs on the click that does it.
    expect(control.actions[0].variant).toBe("destructive");
  });

  it("reports the frozen state destructively, and offers the way out", () => {
    const control = submissionsLockControl(locked());
    expect(control.label).toBe("Submissions locked");
    expect(control.variant).toBe("destructive");
    expect(control.title).toBe("Unlock submissions division-wide?");
    expect(control.actions).toEqual([
      { nextLocked: false, label: "Unlock submissions", variant: "default" },
    ]);
  });

  // The state that must never look like "open": none of the unknown cases is
  // evidence that anything is unfrozen.
  it("does not present an unreadable flag as either locked or open", () => {
    for (const reason of ["no-row", "unusable-flag", "unreadable"] as const) {
      const control = submissionsLockControl(unknown({ reason }));
      expect(control.label).toBe("Lock state unknown");
      expect(control.icon).toBe("alert");
      expect(control.variant).toBe("outline");
    }
  });

  // A deleted singleton is refusing every write right now, and putting the row
  // back open is the only repair. Freezing a division that was never frozen is
  // not one, and neither is a dialog with nothing to click.
  it("offers the one repair for a missing settings row", () => {
    const control = submissionsLockControl(unknown({ reason: "no-row" }));
    expect(control.actions).toEqual([
      { nextLocked: false, label: "Set submissions open", variant: "default" },
    ]);
  });

  // The defect: one button sending `false` is how a transient read failure at a
  // deadline unfreezes a division that was deliberately frozen.
  it("offers both states when the flag could not be read", () => {
    const control = submissionsLockControl(unknown({ reason: "unreadable" }));
    expect(control.actions.map((a) => a.nextLocked)).toEqual([false, true]);
    expect(control.actions.map((a) => a.label)).toEqual([
      "Set submissions open",
      "Lock submissions",
    ]);
    // The freeze keeps the rightmost slot it holds in the open state, so the
    // click that stops every school is always in the same place.
    expect(control.actions.at(-1)?.variant).toBe("destructive");
  });

  // The pre-migration read fails the same way a transient one does, so it gets
  // the same pair. Only the sentence above them differs.
  it("offers the same pair whether or not the switch is installed", () => {
    expect(submissionsLockControl(unknown({ reason: "unreadable" }))).toEqual(
      submissionsLockControl(unknown({ reason: "unreadable", writes: "open" })),
    );
    expect(submissionsLockControl(unknown({ reason: "unreadable" }))).toEqual(
      submissionsLockControl(unknown({ reason: "unreadable", writes: "undetermined" })),
    );
  });

  it("never leaves the two live states looking alike", () => {
    const open = submissionsLockControl({ state: "unlocked" });
    const shut = submissionsLockControl(locked());
    expect(open.label).not.toBe(shut.label);
    expect(open.variant).not.toBe(shut.variant);
    expect(open.actions[0].nextLocked).not.toBe(shut.actions[0].nextLocked);
  });

  it("gives every state something to click", () => {
    const states: SubmissionsLock[] = [
      locked(),
      { state: "unlocked" },
      unknown({ reason: "no-row" }),
      unknown({ reason: "unusable-flag", writes: "undetermined" }),
      unknown({ reason: "unreadable" }),
      unknown({ reason: "unreadable", writes: "open" }),
      unknown({ reason: "unreadable", writes: "undetermined" }),
    ];
    for (const state of states) {
      expect(submissionsLockControl(state).actions.length).toBeGreaterThan(0);
      expect(submissionsLockControl(state).cancelLabel.length).toBeGreaterThan(0);
    }
  });
});
