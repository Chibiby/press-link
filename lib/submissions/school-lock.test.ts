import { describe, expect, it } from "vitest";

import { SUBMISSION_LOCK_ERRORS } from "./lock-errors";
import {
  SCHOOL_LOCK_MESSAGES,
  entrySubmissionLock,
  globalFreezeFromRead,
  schoolLockMessage,
  type GlobalSubmissionsFreeze,
} from "./school-lock";

/**
 * The sentence a locked school has been shown since before the division-wide
 * lock existed, written out here rather than read from the module. This is the
 * path that already works; if a rewording ever drifts into it, this is the
 * failure that says so.
 */
const SCHOOL_COPY = "Your submission is locked. Ask the division office to reopen it.";
const SCHOOL_BANNER_TITLE = "Your submission is locked";
const SCHOOL_BANNER_BODY =
  "Everything below is read-only. Contact the division office if you need a change.";
const SCHOOL_ENTRIES_NOTE =
  "Your submission is locked. Contact the division office if you need a change.";

describe("SCHOOL_LOCK_MESSAGES", () => {
  it("keeps the pre-existing per-school sentence exactly", () => {
    expect(SCHOOL_LOCK_MESSAGES.school).toBe(SCHOOL_COPY);
  });

  it("says something for all three refusals a school can hit", () => {
    for (const message of Object.values(SCHOOL_LOCK_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
    expect(Object.keys(SCHOOL_LOCK_MESSAGES).sort()).toEqual([
      "global",
      "school",
      "unavailable",
    ]);
  });

  // Load-bearing. Unlocking one school does nothing while the division-wide
  // switch is on, so copy that sends the school to ask for a reopen would send
  // it on an errand that cannot work.
  it("never tells a globally frozen school to get itself reopened", () => {
    expect(SCHOOL_LOCK_MESSAGES.global).not.toMatch(/reopen/i);
  });

  // Fail-closed is not the school's fault and not something it can act on, so
  // the copy owes it a wait and an escalation rather than a correction.
  it("gives the fail-closed case something to do", () => {
    expect(SCHOOL_LOCK_MESSAGES.unavailable).toMatch(/try again/i);
    expect(SCHOOL_LOCK_MESSAGES.unavailable).toMatch(/division office/i);
  });
});

describe("schoolLockMessage", () => {
  // The pin between the SQL and this copy: the literals come from the module
  // that also spells them for the migration test.
  it("answers each sentence the guards raise", () => {
    expect(schoolLockMessage({ message: SUBMISSION_LOCK_ERRORS.global }, "fallback")).toBe(
      SCHOOL_LOCK_MESSAGES.global,
    );
    expect(schoolLockMessage({ message: SUBMISSION_LOCK_ERRORS.school }, "fallback")).toBe(
      SCHOOL_LOCK_MESSAGES.school,
    );
    expect(
      schoolLockMessage({ message: SUBMISSION_LOCK_ERRORS.unavailable }, "fallback"),
    ).toBe(SCHOOL_LOCK_MESSAGES.unavailable);
  });

  // The bug this module was written for: the plural sentence does not contain
  // the singular one, so the old substring test fell through to the fallback.
  it("does not answer the division-wide sentence with the per-school one", () => {
    expect(schoolLockMessage({ message: SUBMISSION_LOCK_ERRORS.global }, "fallback")).not.toBe(
      SCHOOL_LOCK_MESSAGES.school,
    );
  });

  it("finds the sentence inside PostgREST framing", () => {
    expect(
      schoolLockMessage(
        {
          message:
            "P0001: submissions are locked division-wide\nCONTEXT: PL/pgSQL function reject_locked_entry_link() line 14",
        },
        "Could not save coaches.",
      ),
    ).toBe(SCHOOL_LOCK_MESSAGES.global);
  });

  // These two are raised by admin_set_submissions_lock(), which a school never
  // calls, so their text arriving here means something else went wrong and the
  // caller's own line is the truer answer.
  it("passes the admin-only refusals through to the fallback", () => {
    expect(
      schoolLockMessage({ message: SUBMISSION_LOCK_ERRORS.notAuthorized }, "Could not add coach."),
    ).toBe("Could not add coach.");
    expect(
      schoolLockMessage(
        { message: SUBMISSION_LOCK_ERRORS.missingArgument },
        "Could not add coach.",
      ),
    ).toBe("Could not add coach.");
  });

  it("falls back for an unrelated failure", () => {
    expect(
      schoolLockMessage(
        { message: 'duplicate key value violates unique constraint "entries_school_event_unique"' },
        "Could not create entry.",
      ),
    ).toBe("Could not create entry.");
  });

  it("falls back for a missing or empty error", () => {
    expect(schoolLockMessage(null, "fallback")).toBe("fallback");
    expect(schoolLockMessage(undefined, "fallback")).toBe("fallback");
    expect(schoolLockMessage({}, "fallback")).toBe("fallback");
    expect(schoolLockMessage({ message: null }, "fallback")).toBe("fallback");
    expect(schoolLockMessage({ message: "" }, "fallback")).toBe("fallback");
  });
});

describe("globalFreezeFromRead", () => {
  it("reads the flag", () => {
    expect(globalFreezeFromRead({ data: { submissions_locked: true }, error: null })).toBe(
      "locked",
    );
    expect(globalFreezeFromRead({ data: { submissions_locked: false }, error: null })).toBe(
      "open",
    );
  });

  // The whole point of the soft failure: 0022 is not applied everywhere, and
  // /entry has to keep working exactly as it did before it was written.
  it("treats a missing table as open", () => {
    expect(
      globalFreezeFromRead({
        data: null,
        error: { message: 'relation "public.app_settings" does not exist' },
      }),
    ).toBe("open");
  });

  it("prefers the error over whatever came back with it", () => {
    expect(
      globalFreezeFromRead({
        data: { submissions_locked: true },
        error: { message: "some transport failure" },
      }),
    ).toBe("open");
  });

  // Not "open". The select policy is scoped `to authenticated`, so no session
  // reads no rows; a deleted singleton reads the same way, and in that case the
  // guards are refusing every write right now.
  it("keeps no row apart from false", () => {
    expect(globalFreezeFromRead({ data: null, error: null })).toBe("unavailable");
    expect(globalFreezeFromRead({ data: undefined, error: undefined })).toBe("unavailable");
  });

  it("treats a null flag the way the guard function does", () => {
    expect(globalFreezeFromRead({ data: { submissions_locked: null }, error: null })).toBe(
      "unavailable",
    );
  });
});

describe("entrySubmissionLock", () => {
  it("leaves an open school open", () => {
    expect(entrySubmissionLock({ schoolLocked: false, global: "open" })).toEqual({
      readOnly: false,
      banner: null,
      entriesNote: null,
    });
  });

  it("renders the per-school lock exactly as before", () => {
    const state = entrySubmissionLock({ schoolLocked: true, global: "open" });
    expect(state.readOnly).toBe(true);
    expect(state.banner).toEqual({
      kind: "school",
      title: SCHOOL_BANNER_TITLE,
      description: SCHOOL_BANNER_BODY,
      icon: "lock",
    });
    expect(state.entriesNote).toBe(SCHOOL_ENTRIES_NOTE);
  });

  it("freezes a school the division-wide switch caught", () => {
    const state = entrySubmissionLock({ schoolLocked: false, global: "locked" });
    expect(state.readOnly).toBe(true);
    expect(state.banner?.kind).toBe("global");
    expect(state.banner?.description).toMatch(/every school/i);
  });

  // One banner, and it is the division-wide one: telling a school to get itself
  // reopened while the switch is on would send it after something that changes
  // nothing.
  it("shows the division-wide banner to a school that is also self-locked", () => {
    const state = entrySubmissionLock({ schoolLocked: true, global: "locked" });
    expect(state.banner?.kind).toBe("global");
    expect(state.entriesNote).not.toBe(SCHOOL_ENTRIES_NOTE);
  });

  it("holds submissions when the setting cannot be read", () => {
    const state = entrySubmissionLock({ schoolLocked: false, global: "unavailable" });
    expect(state.readOnly).toBe(true);
    expect(state.banner?.kind).toBe("unavailable");
    expect(state.banner?.icon).toBe("alert");
  });

  // The school's own lock outlives a setting that will be repaired, so it is the
  // fact worth showing.
  it("prefers a school's own lock to an unreadable setting", () => {
    const state = entrySubmissionLock({ schoolLocked: true, global: "unavailable" });
    expect(state.banner?.kind).toBe("school");
    expect(state.entriesNote).toBe(SCHOOL_ENTRIES_NOTE);
  });

  it("never returns a banner without the read-only state that goes with it", () => {
    const freezes: GlobalSubmissionsFreeze[] = ["open", "locked", "unavailable"];
    for (const global of freezes) {
      for (const schoolLocked of [true, false]) {
        const state = entrySubmissionLock({ schoolLocked, global });
        expect(state.readOnly).toBe(state.banner !== null);
        expect(state.readOnly).toBe(state.entriesNote !== null);
      }
    }
  });
});
