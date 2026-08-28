import { describe, expect, it } from "vitest";

import {
  DEFAULT_DURATION_MINUTES,
  DURATION_PRESETS,
  REVISION_SURFACES,
  SURFACE_DETAIL,
  SURFACE_LABEL,
  activeGrant,
  describeGrant,
  formatExpiry,
  grantAllows,
  remainingLabel,
  surfaceList,
  validateGrantInput,
  type RawRevisionGrant,
  type RevisionGrant,
  type RevisionSurface,
} from "./revision-grant";

/** 28 August 2026, 4:19 PM Manila, written as the UTC instant Postgres returns. */
const EXPIRES = "2026-08-28T08:19:00.000Z";
const EXPIRES_MS = Date.parse(EXPIRES);
const MINUTE = 60_000;

/** 29 minutes before the window shuts. */
const NOW = new Date(EXPIRES_MS - 29 * MINUTE);

/** An instant `ms` before the expiry. Negative reads as past it. */
function before(ms: number): Date {
  return new Date(EXPIRES_MS - ms);
}

function raw(overrides: Partial<RawRevisionGrant> = {}): RawRevisionGrant {
  return {
    id: "grant-1",
    granted_at: "2026-08-28T07:49:00.000Z",
    expires_at: EXPIRES,
    revoked_at: null,
    allow_paper: true,
    allow_roster: true,
    allow_entries: true,
    ...overrides,
  };
}

/**
 * ICU emits a narrow no-break space before AM/PM on some builds and an ordinary
 * space on others, which is invisible in a diff and not what any of these tests
 * are about.
 */
function plain(value: string | null): string | null {
  return value === null ? null : value.replace(/[\u00a0\u202f ]/g, " ");
}

describe("REVISION_SURFACES", () => {
  it("is the three surfaces the guard functions split on, in render order", () => {
    expect(REVISION_SURFACES).toEqual(["paper", "roster", "entries"]);
  });

  it("has a label and a description for every one of them", () => {
    for (const surface of REVISION_SURFACES) {
      expect(SURFACE_LABEL[surface].length).toBeGreaterThan(0);
      expect(SURFACE_DETAIL[surface].length).toBeGreaterThan(0);
    }
  });

  // The label alone does not say that the contest answer rides along with the
  // paper, and an admin unchecking the box needs to know that it does.
  it("names the contest answer under the paper surface", () => {
    expect(SURFACE_DETAIL.paper).toMatch(/contest answer/i);
    expect(SURFACE_DETAIL.roster).toMatch(/coaches/i);
  });
});

describe("activeGrant", () => {
  it("reads a live row into the app shape", () => {
    expect(activeGrant(raw(), NOW)).toEqual({
      id: "grant-1",
      expiresAt: EXPIRES,
      grantedAt: "2026-08-28T07:49:00.000Z",
      surfaces: ["paper", "roster", "entries"],
    });
  });

  it("has nothing to read without a row", () => {
    expect(activeGrant(null, NOW)).toBeNull();
    expect(activeGrant(undefined, NOW)).toBeNull();
  });

  // admin_revoke_revision() stamps rather than deletes, so the row is still there
  // and still unexpired. It is over regardless.
  it("treats a revoked row as no grant even while its window is open", () => {
    expect(activeGrant(raw({ revoked_at: "2026-08-28T07:55:00.000Z" }), NOW)).toBeNull();
  });

  // The boundary that has to agree with `expires_at > now()` inside
  // revision_allows(), in both directions. If this side were inclusive, the banner
  // would announce a window over a database that had already gone back to refusing
  // the write.
  it("is live one millisecond before the expiry", () => {
    expect(activeGrant(raw(), before(1))).not.toBeNull();
  });

  it("is expired exactly at the expiry, not still live", () => {
    expect(activeGrant(raw(), before(0))).toBeNull();
    expect(activeGrant(raw(), new Date(EXPIRES_MS))).toBeNull();
  });

  it("is expired one millisecond after it", () => {
    expect(activeGrant(raw(), before(-1))).toBeNull();
  });

  // Fail closed: a stamp this side cannot read is not evidence of a window.
  it("refuses an unparseable expiry rather than trusting it", () => {
    expect(activeGrant(raw({ expires_at: "not a timestamp" }), NOW)).toBeNull();
    expect(activeGrant(raw({ expires_at: "" }), NOW)).toBeNull();
  });

  it("refuses to decide against an unusable clock", () => {
    expect(activeGrant(raw(), new Date("not a date"))).toBeNull();
  });

  // 0031's CHECK makes this unstorable. A row that got there anyway permits
  // nothing, and a banner over an empty list is worse than no banner.
  it("reads an all-false row as no grant at all", () => {
    expect(
      activeGrant(
        raw({ allow_paper: false, allow_roster: false, allow_entries: false }),
        NOW,
      ),
    ).toBeNull();
  });

  // All eight combinations of the three columns: the seven that are grants, and
  // the empty one that is not.
  it("carries every scope through to the surfaces and the predicate", () => {
    for (const allow_paper of [true, false]) {
      for (const allow_roster of [true, false]) {
        for (const allow_entries of [true, false]) {
          const columns = { allow_paper, allow_roster, allow_entries };
          const expected = REVISION_SURFACES.filter(
            (surface) =>
              (surface === "paper" && allow_paper) ||
              (surface === "roster" && allow_roster) ||
              (surface === "entries" && allow_entries),
          );
          const grant = activeGrant(raw(columns), NOW);

          if (expected.length === 0) {
            expect(grant, JSON.stringify(columns)).toBeNull();
            continue;
          }

          expect(grant?.surfaces, JSON.stringify(columns)).toEqual(expected);
          for (const surface of REVISION_SURFACES) {
            expect(grantAllows(grant, surface), `${surface} ${JSON.stringify(columns)}`).toBe(
              expected.includes(surface),
            );
          }
        }
      }
    }
  });

  // Order comes from the tuple, not from the row, so a two-surface grant reads the
  // same way whichever pair it is.
  it("orders surfaces by the tuple, not by the columns it found", () => {
    expect(activeGrant(raw({ allow_roster: false }), NOW)?.surfaces).toEqual([
      "paper",
      "entries",
    ]);
  });
});

describe("grantAllows", () => {
  it("answers false for every surface when there is no grant", () => {
    for (const surface of REVISION_SURFACES) {
      expect(grantAllows(null, surface)).toBe(false);
    }
  });
});

describe("formatExpiry", () => {
  // The bug this guards: a UTC server printing 8:19 AM for a window the division
  // office was told closes at 4:19 PM.
  it("formats in division time, not the runtime's timezone", () => {
    expect(plain(formatExpiry(EXPIRES))).toBe("4:19 PM");
  });

  it("returns null rather than 'Invalid Date' for nothing usable", () => {
    expect(formatExpiry(null)).toBeNull();
    expect(formatExpiry(undefined)).toBeNull();
    expect(formatExpiry("")).toBeNull();
    expect(formatExpiry("not a timestamp")).toBeNull();
  });
});

describe("remainingLabel", () => {
  // The direction that matters. Telling a school it has 30 minutes when it has 29
  // and a half is how the last save is lost; 29 for 29:59 costs it nothing.
  it("rounds down, never up", () => {
    expect(remainingLabel(EXPIRES, before(29 * MINUTE + 30_000))).toBe("29 minutes");
    expect(remainingLabel(EXPIRES, before(29 * MINUTE + 59_999))).toBe("29 minutes");
    expect(remainingLabel(EXPIRES, before(30 * MINUTE))).toBe("30 minutes");
  });

  it("keeps the minute singular at one", () => {
    expect(remainingLabel(EXPIRES, before(MINUTE))).toBe("1 minute");
    expect(remainingLabel(EXPIRES, before(MINUTE + 59_000))).toBe("1 minute");
  });

  // Not "1 minute". Rounding the last seconds up would promise time already gone.
  it("says under a minute rather than promising one", () => {
    expect(remainingLabel(EXPIRES, before(59_999))).toBe("under a minute");
    expect(remainingLabel(EXPIRES, before(1))).toBe("under a minute");
  });

  it("drops the empty half of an hour-and-minutes label", () => {
    expect(remainingLabel(EXPIRES, before(60 * MINUTE))).toBe("1 hour");
    expect(remainingLabel(EXPIRES, before(120 * MINUTE))).toBe("2 hours");
    expect(remainingLabel(EXPIRES, before(1440 * MINUTE))).toBe("24 hours");
  });

  it("puts both halves together when both are there", () => {
    expect(remainingLabel(EXPIRES, before(65 * MINUTE))).toBe("1 hour 5 minutes");
    expect(remainingLabel(EXPIRES, before(121 * MINUTE))).toBe("2 hours 1 minute");
    expect(remainingLabel(EXPIRES, before(60 * MINUTE + 59_999))).toBe("1 hour");
  });

  // Exclusive at the boundary, agreeing with activeGrant() and revision_allows().
  it("is expired at the boundary and past it", () => {
    expect(remainingLabel(EXPIRES, before(0))).toBe("expired");
    expect(remainingLabel(EXPIRES, before(-1))).toBe("expired");
    expect(remainingLabel(EXPIRES, before(-60 * MINUTE))).toBe("expired");
  });

  // Fail closed. Unreachable through activeGrant(), which parses the stamp first.
  it("reads an unusable expiry or clock as expired, never as time left", () => {
    expect(remainingLabel("not a timestamp", NOW)).toBe("expired");
    expect(remainingLabel(EXPIRES, new Date("not a date"))).toBe("expired");
  });
});

describe("surfaceList", () => {
  it("builds the three list shapes", () => {
    expect(surfaceList(["entries"])).toBe("entries");
    expect(surfaceList(["roster", "entries"])).toBe("roster and entries");
    expect(surfaceList(["paper", "roster", "entries"])).toBe(
      "school paper, roster and entries",
    );
  });

  // The order a caller passes cannot reach the sentence, so one grant reads the
  // same in the admin cell and in the school banner.
  it("normalises order and duplicates out of the list it was handed", () => {
    expect(surfaceList(["entries", "paper"])).toBe("school paper and entries");
    expect(surfaceList(["entries", "entries"])).toBe("entries");
  });

  it("has nothing to say about an empty list", () => {
    expect(surfaceList([])).toBe("");
  });
});

describe("describeGrant", () => {
  function grant(surfaces: RevisionSurface[]): RevisionGrant {
    return { id: "grant-1", expiresAt: EXPIRES, grantedAt: EXPIRES, surfaces };
  }

  it("names the window and the scope", () => {
    expect(describeGrant(grant(["paper", "roster", "entries"]), "4:19 PM")).toBe(
      "Revision open until 4:19 PM — school paper, roster and entries.",
    );
    expect(describeGrant(grant(["roster", "entries"]), "4:19 PM")).toBe(
      "Revision open until 4:19 PM — roster and entries.",
    );
    expect(describeGrant(grant(["entries"]), "4:19 PM")).toBe(
      "Revision open until 4:19 PM — entries.",
    );
  });

  // Unreachable while the 0031 `not null` holds, which is why it says so plainly
  // rather than guessing a time — the same handling describeLockStamp() gives its
  // own missing stamp.
  it("does not invent a time when the label is missing", () => {
    const line = describeGrant(grant(["entries"]), null);
    expect(line).toBe("Revision open, with no expiry time recorded against it — entries.");
    expect(line).not.toContain("Invalid");
    expect(line).not.toContain("until");
  });
});

describe("DURATION_PRESETS", () => {
  it("offers the six the design settled on, shortest first", () => {
    expect(DURATION_PRESETS.map((preset) => preset.minutes)).toEqual([
      15, 30, 60, 120, 240, 1440,
    ]);
  });

  // The top preset is the clamp the RPC applies. A preset above it would be
  // silently narrowed by the database, leaving the admin screen and the stored row
  // disagreeing about when the window shuts.
  it("never offers a duration the validator would refuse", () => {
    for (const preset of DURATION_PRESETS) {
      expect(
        validateGrantInput({ surfaces: ["entries"], minutes: preset.minutes }),
        preset.label,
      ).toEqual({ surfaces: ["entries"], minutes: preset.minutes });
    }
  });

  it("defaults to a preset that is actually on offer", () => {
    expect(
      DURATION_PRESETS.some((preset) => preset.minutes === DEFAULT_DURATION_MINUTES),
    ).toBe(true);
  });
});

describe("validateGrantInput", () => {
  const SCOPE_ERROR = "Choose at least one thing the school may revise.";
  const MINUTES_ERROR = "Choose how long the window stays open, up to 24 hours.";

  it("passes a checked input through in tuple order", () => {
    expect(validateGrantInput({ surfaces: ["entries", "paper"], minutes: 30 })).toEqual({
      surfaces: ["paper", "entries"],
      minutes: 30,
    });
  });

  it("takes both ends of the range", () => {
    expect(validateGrantInput({ surfaces: ["paper"], minutes: 1 })).toEqual({
      surfaces: ["paper"],
      minutes: 1,
    });
    expect(validateGrantInput({ surfaces: ["paper"], minutes: 1440 })).toEqual({
      surfaces: ["paper"],
      minutes: 1440,
    });
  });

  // A Server Action is a public POST endpoint. The modal is one caller, not the
  // only possible one, so surfaces is checked for being an array at all before
  // anything is read out of it.
  it("refuses anything that is not an array of surfaces", () => {
    for (const surfaces of ["paper", { paper: true }, 3, null, undefined, true]) {
      expect(validateGrantInput({ surfaces, minutes: 30 }), String(surfaces)).toEqual({
        error: SCOPE_ERROR,
      });
    }
  });

  it("refuses an empty scope, naming what is needed", () => {
    expect(validateGrantInput({ surfaces: [], minutes: 30 })).toEqual({ error: SCOPE_ERROR });
  });

  // Dropped, not passed through: an unrecognised value must never reach a column
  // lookup, and one recognised value among junk is still a valid grant.
  it("drops values that are not one of the three surfaces", () => {
    expect(
      validateGrantInput({ surfaces: ["entries", "everything", 7, null], minutes: 30 }),
    ).toEqual({ surfaces: ["entries"], minutes: 30 });
    expect(validateGrantInput({ surfaces: ["everything"], minutes: 30 })).toEqual({
      error: SCOPE_ERROR,
    });
  });

  it("deduplicates a scope that arrived doubled", () => {
    expect(
      validateGrantInput({ surfaces: ["entries", "entries", "paper"], minutes: 30 }),
    ).toEqual({ surfaces: ["paper", "entries"], minutes: 30 });
  });

  // Not coerced. Number("30") succeeding is how a string that should have been
  // refused becomes a duration, and Number("") is 0.
  it("refuses a minutes value that is not an integer in range", () => {
    for (const minutes of [0, -30, 1441, 1.5, NaN, Infinity, "30", "", null, undefined, {}]) {
      expect(validateGrantInput({ surfaces: ["entries"], minutes }), String(minutes)).toEqual({
        error: MINUTES_ERROR,
      });
    }
  });

  // Order mirrors the modal: the checkboxes sit above the duration, so the first
  // error names the first control the eye would reach.
  it("reports the scope before the duration when both are wrong", () => {
    expect(validateGrantInput({ surfaces: [], minutes: 9999 })).toEqual({ error: SCOPE_ERROR });
  });
});
