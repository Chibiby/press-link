import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SUBMISSION_LOCK_ERRORS,
  SUBMISSION_LOCK_MESSAGES,
  classifySubmissionLockError,
  submissionLockMessage,
  type SubmissionLockErrorKind,
} from "./lock-errors";

/**
 * The literals as fixtures, written out rather than read from the module under
 * test. A test that spells `SUBMISSION_LOCK_ERRORS.global` cannot notice the day
 * someone edits it; this list can.
 */
const LITERALS: Record<SubmissionLockErrorKind, string> = {
  global: "submissions are locked division-wide",
  school: "submission is locked",
  unavailable: "submission lock state unavailable",
  notAuthorized: "not authorized",
  missingArgument: "locked is required",
};

function migration(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../supabase/migrations/${file}`, import.meta.url)),
    "utf8",
  );
}

const MIGRATION = migration("0022_global_submissions_lock.sql");

/**
 * Which of these sentences each migration raises.
 *
 * 0022 is where all five were written, and it stayed the only file to raise them
 * until 0023 guarded `set_paper_participation`: `schools` carries no trigger, so
 * that RPC had to test the flag itself, and it carries its own copy of two of
 * these sentences character for character. A second copy is a second place to
 * reword one, so it is pinned here the same way — 0023's own header says it
 * matters, and this is what makes that enforceable rather than aspirational.
 */
const RAISED_BY: Record<string, SubmissionLockErrorKind[]> = {
  "0022_global_submissions_lock.sql": [
    "global",
    "school",
    "unavailable",
    "notAuthorized",
    "missingArgument",
  ],
  "0023_lock_paper_participation.sql": ["global", "school"],
};

describe("SUBMISSION_LOCK_ERRORS", () => {
  it("holds exactly the five sentences the guards raise", () => {
    expect(SUBMISSION_LOCK_ERRORS).toEqual(LITERALS);
  });

  // The pin. Nothing else in the repo checks that the SQL and the TypeScript
  // still agree, so if a migration rewords one of these sentences, this is the
  // failure that says so.
  it("matches sentences that migration 0022 actually raises", () => {
    for (const [kind, literal] of Object.entries(LITERALS)) {
      expect(MIGRATION, `${kind} is no longer raised by 0022`).toContain(
        `raise exception '${literal}'`,
      );
    }
  });

  // The same pin over every other migration that raises one of them. Two files
  // spelling 'submissions are locked division-wide' means two files that can
  // drift from `rpcMessage()` in app/entry/roster-actions.ts, which matches on
  // the text and would answer a school "ask the division office to reopen it" —
  // advice that is false while the switch is on.
  it("matches the copies carried by every other migration that raises them", () => {
    for (const [file, kinds] of Object.entries(RAISED_BY)) {
      const sql = migration(file);
      for (const kind of kinds) {
        expect(sql, `${kind} is no longer raised by ${file}`).toContain(
          `raise exception '${SUBMISSION_LOCK_ERRORS[kind]}'`,
        );
      }
    }
  });

  // Load-bearing: `rpcMessage()` in app/entry/roster-actions.ts matches
  // 'submission is locked' as a substring, and would swallow the division-wide
  // message into the school-level explanation if the plural sentence contained
  // the singular one. It does not, and this is what keeps that true.
  it("keeps the division-wide sentence free of the per-school one", () => {
    expect(LITERALS.global).not.toContain(LITERALS.school);
    expect(LITERALS.unavailable).not.toContain(LITERALS.school);
  });

  it("gives every kind a message", () => {
    for (const kind of Object.keys(LITERALS) as SubmissionLockErrorKind[]) {
      expect(SUBMISSION_LOCK_MESSAGES[kind].length).toBeGreaterThan(0);
    }
  });
});

describe("classifySubmissionLockError", () => {
  it("classifies each raised sentence", () => {
    for (const [kind, literal] of Object.entries(LITERALS)) {
      expect(classifySubmissionLockError(literal)).toBe(kind);
    }
  });

  // What actually arrives from PostgREST is the sentence inside its framing.
  it("finds the sentence inside PostgREST framing", () => {
    expect(
      classifySubmissionLockError(
        'P0001: submissions are locked division-wide\nCONTEXT: PL/pgSQL function reject_locked_submission() line 12',
      ),
    ).toBe("global");
  });

  it("reports the division-wide case, not the per-school one", () => {
    expect(classifySubmissionLockError(LITERALS.global)).toBe("global");
    expect(classifySubmissionLockError(LITERALS.school)).toBe("school");
  });

  it("returns null for a failure we did not raise", () => {
    expect(
      classifySubmissionLockError(
        'Could not find the function public.admin_set_submissions_lock(locked) in the schema cache',
      ),
    ).toBeNull();
    expect(classifySubmissionLockError('relation "app_settings" does not exist')).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(classifySubmissionLockError(null)).toBeNull();
    expect(classifySubmissionLockError(undefined)).toBeNull();
    expect(classifySubmissionLockError("")).toBeNull();
  });
});

describe("submissionLockMessage", () => {
  it("answers a recognised sentence with its own copy", () => {
    expect(submissionLockMessage({ message: LITERALS.notAuthorized }, "fallback")).toBe(
      SUBMISSION_LOCK_MESSAGES.notAuthorized,
    );
  });

  // The pre-migration case: the RPC does not exist yet, and the database's own
  // sentence is the only thing that identifies why.
  it("passes an unrecognised failure through to the fallback", () => {
    const raw = "Could not find the function public.admin_set_submissions_lock(locked)";
    expect(submissionLockMessage({ message: raw }, `Could not lock submissions: ${raw}`)).toBe(
      `Could not lock submissions: ${raw}`,
    );
  });

  it("falls back for a missing or empty error", () => {
    expect(submissionLockMessage(null, "fallback")).toBe("fallback");
    expect(submissionLockMessage(undefined, "fallback")).toBe("fallback");
    expect(submissionLockMessage({}, "fallback")).toBe("fallback");
    expect(submissionLockMessage({ message: null }, "fallback")).toBe("fallback");
  });
});
