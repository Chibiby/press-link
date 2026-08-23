/**
 * The sentences the submission-lock guards raise, and the copy that answers each
 * one.
 *
 * These five literals live twice: once in
 * `supabase/migrations/0022_global_submissions_lock.sql`, where they are raised,
 * and once here, where they are matched. Nothing in either language checks the
 * other, so the colocated test reads that migration and asserts every literal
 * below still appears in it. That test is the only thing pinning the two copies
 * together; if a migration ever rewords one of these, it is what tells you
 * before an admin sees a fallback message instead of an explanation.
 *
 * `app/entry/roster-actions.ts` still carries its own school-facing wording for
 * `submission is locked` and three paper-flow sentences of its own. This module
 * is where that should converge, not a replacement for it — the copy here is
 * written for the division office, which is a different reader.
 */
export const SUBMISSION_LOCK_ERRORS = {
  /**
   * `app_settings.submissions_locked` is true. Every school-side write is
   * frozen, and unlocking one school changes nothing while this holds.
   */
  global: "submissions are locked division-wide",
  /** `schools.submission_locked_at` is set for the caller's own school. */
  school: "submission is locked",
  /**
   * The flag could not be read, so the guards refused the write rather than
   * waving it through. Not a lock — a broken switch.
   */
  unavailable: "submission lock state unavailable",
  /** `admin_set_submissions_lock()` refused a caller with no admin_profiles row. */
  notAuthorized: "not authorized",
  /** `admin_set_submissions_lock(null)`. */
  missingArgument: "locked is required",
} as const;

export type SubmissionLockErrorKind = keyof typeof SUBMISSION_LOCK_ERRORS;

/**
 * Match order, most specific first.
 *
 * The pair that could collide is `global` and `school`: the two sentences are
 * about the same subject and one of them is short. They do not collide today —
 * "submissions are locked division-wide" does not contain "submission is
 * locked", because the plural carries "submissions are" where the singular
 * carries "submission is" — and the test asserts that rather than trusting it.
 * Ordering the longer one first means a future rewording that *did* introduce
 * the overlap would still be reported as the division-wide case, which is the
 * one an admin has to act on.
 */
const MATCH_ORDER: readonly SubmissionLockErrorKind[] = [
  "global",
  "unavailable",
  "school",
  "notAuthorized",
  "missingArgument",
];

/**
 * Which raised sentence this is, or null for anything we did not raise.
 *
 * Substring rather than equality: a Postgres exception reaches the client inside
 * PostgREST's own framing, so the message is not guaranteed to be only the text
 * that was raised.
 */
export function classifySubmissionLockError(
  message: string | null | undefined,
): SubmissionLockErrorKind | null {
  if (!message) return null;

  for (const kind of MATCH_ORDER) {
    if (message.includes(SUBMISSION_LOCK_ERRORS[kind])) return kind;
  }

  return null;
}

/**
 * Admin-facing copy. Each line says what happened and what the reader can do
 * about it, because every one of these is reachable from a button in `/admin`.
 */
export const SUBMISSION_LOCK_MESSAGES: Record<SubmissionLockErrorKind, string> = {
  global:
    "Submissions are already locked division-wide. Turn the division-wide lock off before editing school-side data.",
  school:
    "That school has locked its own submission. Reopen it from School Papers first.",
  unavailable:
    "The division-wide lock setting could not be read, so submissions are being refused until it can be. Check that app_settings still holds its single row.",
  notAuthorized: "You are not authorized to change the division-wide submission lock.",
  missingArgument: "No lock state was sent. Try the switch again.",
};

/**
 * The message to show for a failed call, falling back to `fallback` for anything
 * this module does not recognise.
 *
 * Callers are expected to put the database's own text in `fallback`. An
 * unrecognised failure here is usually structural — the function or the table is
 * absent on this environment — and a generic "something went wrong" would hide
 * the one sentence that identifies it.
 */
export function submissionLockMessage(
  error: { message?: string | null } | null | undefined,
  fallback: string,
): string {
  const kind = classifySubmissionLockError(error?.message);
  return kind ? SUBMISSION_LOCK_MESSAGES[kind] : fallback;
}
