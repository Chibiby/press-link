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

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL("../../supabase/migrations/0022_global_submissions_lock.sql", import.meta.url),
  ),
  "utf8",
);

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
