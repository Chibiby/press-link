import { describe, expect, it } from "vitest";

import { SUBMISSION_LOCK_ERRORS } from "./lock-errors";
import {
  REVISION_SURFACES,
  activeGrant,
  type RevisionGrant,
  type RevisionSurface,
} from "./revision-grant";
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

/**
 * What the old boolean `readOnly: true` meant, and what it still means for every
 * state without a grant in it: all three surfaces refused.
 */
const ALL_FROZEN: Record<RevisionSurface, boolean> = {
  paper: true,
  roster: true,
  entries: true,
};

const NONE_FROZEN: Record<RevisionSurface, boolean> = {
  paper: false,
  roster: false,
  entries: false,
};

/** 28 August 2026, 4:19 PM Manila, as the UTC instant Postgres returns. */
const EXPIRES = "2026-08-28T08:19:00.000Z";

/**
 * A live grant, built the way `/entry` builds it — through `activeGrant()` rather
 * than by hand, so these tests cannot assert a shape the parser would never
 * produce. `now` is half an hour inside the window.
 */
function grant(surfaces: RevisionSurface[]): RevisionGrant {
  const live = activeGrant(
    {
      id: "grant-1",
      granted_at: "2026-08-28T07:49:00.000Z",
      expires_at: EXPIRES,
      revoked_at: null,
      allow_paper: surfaces.includes("paper"),
      allow_roster: surfaces.includes("roster"),
      allow_entries: surfaces.includes("entries"),
    },
    new Date("2026-08-28T07:49:00.000Z"),
  );
  if (!live) throw new Error("fixture is not a live grant");
  return live;
}

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
      readOnly: NONE_FROZEN,
      banner: null,
      entriesNote: null,
    });
  });

  it("renders the per-school lock exactly as before", () => {
    const state = entrySubmissionLock({ schoolLocked: true, global: "open" });
    expect(state.readOnly).toEqual(ALL_FROZEN);
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
    expect(state.readOnly).toEqual(ALL_FROZEN);
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
    expect(state.readOnly).toEqual(ALL_FROZEN);
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

  // Still asserted over the six ungranted states only, which is what it was
  // written for: with no grant every surface moves together, so "read-only" is one
  // fact again and a banner without it, or it without a banner, is a bug. The
  // granted states break the equivalence deliberately — a reopened surface is
  // writable *and* carries a banner — and they are covered below.
  it("never returns a banner without the read-only state that goes with it", () => {
    const freezes: GlobalSubmissionsFreeze[] = ["open", "locked", "unavailable"];
    for (const global of freezes) {
      for (const schoolLocked of [true, false]) {
        const state = entrySubmissionLock({ schoolLocked, global });
        const frozen = REVISION_SURFACES.every((surface) => state.readOnly[surface]);
        expect(frozen).toBe(state.banner !== null);
        expect(frozen).toBe(state.entriesNote !== null);
        // All of them or none of them, never a mix, until a grant says otherwise.
        expect(REVISION_SURFACES.some((surface) => state.readOnly[surface])).toBe(frozen);
      }
    }
  });
});

/**
 * ICU emits a narrow no-break space before AM/PM on some builds and an ordinary
 * space on others, which is invisible in a diff and not what any of these tests
 * are about.
 */
function plain(value: string): string {
  return value.replace(/[\u00a0\u202f ]/g, " ");
}

describe("entrySubmissionLock with a revision grant", () => {
  // The whole table, so a change to precedence has to be argued for rather than
  // slipped in: four states, three surfaces, and the grant winning every state it
  // is put against.
  it("decides all four states across all three surfaces", () => {
    const cases: {
      name: string;
      input: Parameters<typeof entrySubmissionLock>[0];
      readOnly: Record<RevisionSurface, boolean>;
      kind: string | null;
    }[] = [
      {
        name: "nothing frozen",
        input: { schoolLocked: false, global: "open" },
        readOnly: NONE_FROZEN,
        kind: null,
      },
      {
        name: "division-wide freeze",
        input: { schoolLocked: false, global: "locked" },
        readOnly: ALL_FROZEN,
        kind: "global",
      },
      {
        name: "the school's own lock",
        input: { schoolLocked: true, global: "open" },
        readOnly: ALL_FROZEN,
        kind: "school",
      },
      {
        name: "an unreadable setting",
        input: { schoolLocked: false, global: "unavailable" },
        readOnly: ALL_FROZEN,
        kind: "unavailable",
      },
      {
        name: "a full grant inside a division-wide freeze",
        input: {
          schoolLocked: false,
          global: "locked",
          grant: grant(["paper", "roster", "entries"]),
        },
        readOnly: NONE_FROZEN,
        kind: "grant",
      },
      {
        name: "a full grant over the school's own lock",
        input: {
          schoolLocked: true,
          global: "open",
          grant: grant(["paper", "roster", "entries"]),
        },
        readOnly: NONE_FROZEN,
        kind: "grant",
      },
      {
        name: "a full grant over an unreadable setting",
        input: {
          schoolLocked: false,
          global: "unavailable",
          grant: grant(["paper", "roster", "entries"]),
        },
        readOnly: NONE_FROZEN,
        kind: "grant",
      },
    ];

    for (const scenario of cases) {
      const state = entrySubmissionLock(scenario.input);
      expect(state.readOnly, scenario.name).toEqual(scenario.readOnly);
      expect(state.banner?.kind ?? null, scenario.name).toBe(scenario.kind);
    }
  });

  // The state the whole feature exists for. Entries reopen, the roster and the
  // paper stay exactly as frozen as the division-wide switch left them, and the
  // 0022 guards agree with all three of those readings.
  it("reopens only the surfaces the grant covers", () => {
    const state = entrySubmissionLock({
      schoolLocked: false,
      global: "locked",
      grant: grant(["entries"]),
    });
    expect(state.readOnly.entries).toBe(false);
    expect(state.readOnly.paper).toBe(true);
    expect(state.readOnly.roster).toBe(true);
    expect(state.banner?.kind).toBe("grant");
  });

  // A grant is the office saying go ahead, and 0031 asks revision_allows() before
  // it looks at either lock — so a grant beats both at once, not one of them.
  it("beats the school's own lock and the division-wide one together", () => {
    const state = entrySubmissionLock({
      schoolLocked: true,
      global: "locked",
      grant: grant(["entries"]),
    });
    expect(state.readOnly.entries).toBe(false);
    expect(state.readOnly.paper).toBe(true);
    expect(state.readOnly.roster).toBe(true);
    expect(state.banner?.kind).toBe("grant");
  });
});

describe("the revision grant banner", () => {
  function banner(surfaces: RevisionSurface[], global: GlobalSubmissionsFreeze = "locked") {
    const state = entrySubmissionLock({ schoolLocked: false, global, grant: grant(surfaces) });
    if (state.banner?.kind !== "grant") throw new Error("expected the grant banner");
    return state.banner;
  }

  it("announces the reopening and the time it shuts", () => {
    const open = banner(["paper", "roster", "entries"]);
    expect(open.title).toBe("The division office reopened your work");
    expect(plain(open.description)).toBe(
      "You can edit your school paper, roster and entries until 4:19 PM. Anything you have not saved by then is refused.",
    );
  });

  // The claim that must not be overstated. A school whose roster is still refusing
  // every write would otherwise find that out from a failed save.
  it("names what stayed frozen instead of implying everything reopened", () => {
    expect(plain(banner(["entries"]).description)).toBe(
      "You can edit your entries until 4:19 PM. Anything you have not saved by then is refused. Your school paper and roster stay read-only.",
    );
    expect(plain(banner(["paper", "roster"]).description)).toBe(
      "You can edit your school paper and roster until 4:19 PM. Anything you have not saved by then is refused. Your entries stays read-only.",
    );
  });

  it("carries the surfaces in tuple order for the page to mark panels with", () => {
    expect(banner(["entries", "paper"]).surfaces).toEqual(["paper", "entries"]);
  });

  // The raw instant for the countdown, the formatted one for the sentence beside
  // it. Formatting the same instant in the browser as well is a hydration mismatch
  // over the space before "PM".
  it("hands over both the instant and the division-time label", () => {
    const open = banner(["entries"]);
    expect(open.expiresAt).toBe(EXPIRES);
    expect(plain(open.expiryLabel ?? "")).toBe("4:19 PM");
  });

  // A boolean "seen it" flag cannot tell a refresh from a new grant. The id can.
  it("carries the grant id, so the modal fires once per grant and not once ever", () => {
    expect(banner(["entries"]).grantId).toBe("grant-1");
  });

  // Neither the lock nor the fail-closed triangle: this is the one state the school
  // can act on, and a warning sign over it would read as a fourth kind of trouble.
  it("takes its own icon rather than borrowing a frozen one", () => {
    expect(banner(["entries"]).icon).toBe("clock");
  });

  it("says the same things whichever lock it is overriding", () => {
    expect(banner(["entries"], "unavailable")).toEqual(banner(["entries"], "locked"));
  });
});

describe("entriesNote under a revision grant", () => {
  function note(surfaces: RevisionSurface[]): string | null {
    return entrySubmissionLock({
      schoolLocked: false,
      global: "locked",
      grant: grant(surfaces),
    }).entriesNote;
  }

  // The note answers for the entries surface specifically. A grant covering only
  // the paper leaves entries as frozen as they were, and this line is the only
  // place under the Entries heading where the school is told so.
  it("keeps the frozen note when the grant does not reach entries", () => {
    expect(note(["paper"])).toBe(
      "Submissions are closed division-wide. Nothing can be saved until they reopen.",
    );
    expect(note(["paper", "roster"])).toBe(
      "Submissions are closed division-wide. Nothing can be saved until they reopen.",
    );
  });

  // Not the ordinary "Every contest your school is competing in": true, and useless
  // at the moment the school starts typing into a window that closes.
  it("says the window is temporary when the grant does reach entries", () => {
    expect(note(["entries"])).toBe(
      "The division office reopened your entries for a short time. Save each change before the window closes.",
    );
  });

  // No minute figure, because a server-rendered one keeps claiming the same number
  // for as long as the page stays open. The countdown owns that.
  it("names no duration of its own", () => {
    expect(note(["entries"])).not.toMatch(/\d+ minute/);
  });
});

describe("entrySubmissionLock without a usable grant", () => {
  // Callers written before 0031 pass nothing, and must be unaffected on every
  // surface.
  it("behaves identically whether the grant is absent, null or undefined", () => {
    const expected = entrySubmissionLock({ schoolLocked: false, global: "locked" });
    expect(entrySubmissionLock({ schoolLocked: false, global: "locked", grant: null })).toEqual(
      expected,
    );
    expect(
      entrySubmissionLock({ schoolLocked: false, global: "locked", grant: undefined }),
    ).toEqual(expected);
  });

  // A grant outlives an unlock — the office lifts the deadline and the row stays
  // live for another twenty minutes — and "the division office reopened your work"
  // over a school that was never shut is a notice about nothing.
  it("announces nothing when there was no freeze to override", () => {
    expect(
      entrySubmissionLock({
        schoolLocked: false,
        global: "open",
        grant: grant(["paper", "roster", "entries"]),
      }),
    ).toEqual({ readOnly: NONE_FROZEN, banner: null, entriesNote: null });
  });

  // The 0031 CHECK makes this unstorable and activeGrant() refuses to build one.
  // The third fence: "you can edit your " followed by nothing would be a worse
  // banner than the frozen one it displaced.
  it("falls back to the frozen banner for a grant that permits nothing", () => {
    const empty: RevisionGrant = {
      id: "grant-1",
      expiresAt: EXPIRES,
      grantedAt: EXPIRES,
      surfaces: [],
    };
    const state = entrySubmissionLock({ schoolLocked: false, global: "locked", grant: empty });
    expect(state.readOnly).toEqual(ALL_FROZEN);
    expect(state.banner?.kind).toBe("global");
    expect(state.entriesNote).toBe(
      "Submissions are closed division-wide. Nothing can be saved until they reopen.",
    );
  });

  // Not this module's decision to make twice. An expired or revoked row is filtered
  // by activeGrant(), and REVISION_SURFACES.every() below is what would catch a
  // surface quietly going missing from the record.
  it("freezes every surface named in the tuple when there is no grant", () => {
    const state = entrySubmissionLock({ schoolLocked: true, global: "open" });
    for (const surface of REVISION_SURFACES) {
      expect(state.readOnly[surface], surface).toBe(true);
    }
  });
});
