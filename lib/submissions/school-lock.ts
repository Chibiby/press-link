/**
 * The school's side of the submission lock: what `/entry` tells a school when a
 * write is refused, and whether it presents its forms as open at all.
 *
 * `lock-errors.ts` holds the sentences the guards raise and the copy that answers
 * them for the **division office**. A school is a different reader: it cannot
 * check `app_settings`, cannot flip anything, and mostly needs to know whether
 * the work in front of it is worth doing. So the matching is imported from there
 * — the raised literals are spelled in exactly one module — and only the wording
 * is written again here.
 *
 * Nothing in this module enforces anything. The guard triggers from migration
 * 0022 refuse the write inside the database, on every school-side table; this is
 * only how that refusal gets explained.
 */
import {
  classifySubmissionLockError,
  type SubmissionLockErrorKind,
} from "./lock-errors";

/**
 * The three sentences a school-side write can be refused with. The other two
 * kinds `lock-errors.ts` knows about (`notAuthorized`, `missingArgument`) come
 * from `admin_set_submissions_lock()`, which no school ever calls, so they are
 * deliberately absent: an unrelated failure whose text happens to contain "not
 * authorized" should reach the caller's own fallback rather than be dressed up as
 * a lock.
 */
export type SchoolLockErrorKind = Extract<
  SubmissionLockErrorKind,
  "global" | "school" | "unavailable"
>;

function isSchoolLockKind(
  kind: SubmissionLockErrorKind | null,
): kind is SchoolLockErrorKind {
  return kind === "global" || kind === "school" || kind === "unavailable";
}

/**
 * School-facing copy for a refused write.
 *
 * `school` is the sentence `/entry` has always shown for a school's own lock,
 * character for character. It is correct and the school acts on it; this module
 * exists to add the other two, not to reword that one.
 */
export const SCHOOL_LOCK_MESSAGES: Record<SchoolLockErrorKind, string> = {
  school: "Your submission is locked. Ask the division office to reopen it.",
  // Deliberately not "ask the division office to reopen your submission": while
  // the division-wide switch is on, reopening this one school changes nothing, so
  // that would be false advice. It says what is true instead — nothing is lost,
  // and nothing on the school's side is broken.
  global:
    "Submissions are closed division-wide, so this could not be saved. Nothing you have already saved is lost, and there is nothing to fix on your side.",
  // Fail-closed, not a lock: the database could not positively read the switch
  // and refused the write rather than waving it through. The school did nothing
  // wrong and can do nothing about it, so the only honest instruction is to wait,
  // and to escalate if waiting stops working.
  unavailable:
    "Submissions are on hold because the division-wide lock setting could not be read, so this could not be saved. Nothing you have already saved is lost. Please try again in a few minutes, and contact the division office if it keeps happening.",
};

/**
 * The school-facing message for a failed write, or `fallback` for any failure
 * that is not one of the three lock refusals.
 *
 * Unlike the admin version, the fallback here is the caller's own generic line
 * and never the database's text: a school cannot act on a constraint name, and
 * the raw message is already in the server log.
 */
export function schoolLockMessage(
  error: { message?: string | null } | null | undefined,
  fallback: string,
): string {
  const kind = classifySubmissionLockError(error?.message);
  return isSchoolLockKind(kind) ? SCHOOL_LOCK_MESSAGES[kind] : fallback;
}

/**
 * The division-wide switch as `/entry` managed to read it.
 *
 * `unavailable` is not "the read failed" — it is "the read answered, and it does
 * not say", which is the state in which `submissions_locked_globally()` raises
 * and every school-side write is already being refused. A read that fails
 * outright is `open`, because the ordinary reason for it is that 0022 has not
 * been applied here and there is no switch to obey.
 */
export type GlobalSubmissionsFreeze = "open" | "locked" | "unavailable";

/**
 * Turn the `app_settings` read into the state the dashboard should render.
 *
 * **This is deliberately fail-soft, and it is not a hole.** The enforcer is the
 * database: the 0022 triggers refuse every school-side write using the flag they
 * read themselves, and this read guards nothing. Its only job is to stop `/entry`
 * presenting open forms during a freeze. So when the table is not there — the
 * state of production until 0022 is applied — the page must render exactly as it
 * did before this feature existed rather than 500 on a select against a missing
 * relation. Do not "harden" this into a throw: it would take the whole school
 * dashboard down without making one single write more, or less, permitted.
 *
 * No row is kept apart from `false` on purpose. 0022 scoped the select policy `to
 * authenticated`, so a caller without a session reads zero rows rather than an
 * unlocked flag, and a deleted singleton reads the same way — and in that second
 * case the guards are raising 'submission lock state unavailable' at this very
 * moment. Reading either as "open" is the one answer that would be wrong.
 */
export function globalFreezeFromRead(read: {
  data: { submissions_locked: boolean | null } | null | undefined;
  error: { message?: string | null } | null | undefined;
}): GlobalSubmissionsFreeze {
  if (read.error) return "open";
  // A null flag counts as unavailable because that is what the database does with
  // it: `submissions_locked_globally()` raises on a null rather than returning
  // false, so the page agrees with the guard instead of guessing past it.
  if (!read.data || read.data.submissions_locked === null) return "unavailable";
  return read.data.submissions_locked ? "locked" : "open";
}

export interface EntryLockBanner {
  kind: SchoolLockErrorKind;
  title: string;
  description: string;
  /** Mirrors the admin control: this picks the meaning, the page picks the component. */
  icon: "lock" | "alert";
}

export interface EntrySubmissionLock {
  /**
   * The school paper, the roster, the entries and the contest answer are all
   * read-only, because every write behind them is being refused: the 0022 guard
   * triggers cover the tables, and 0023 gave `set_paper_participation()` the same
   * division-wide check, which was the one write path that had slipped past it.
   *
   * The single exception is `lock_submission()`, still as 0011 defined it and
   * guarded by neither migration. A school can lock itself mid-freeze, so the
   * page leaves that button alone rather than inventing an enforcement the
   * database does not have.
   */
  readOnly: boolean;
  /** The one banner at the top of the dashboard, or null when nothing is frozen. */
  banner: EntryLockBanner | null;
  /** Replaces the line under the Entries heading while writes are refused. */
  entriesNote: string | null;
}

const BANNERS: Record<SchoolLockErrorKind, EntryLockBanner> = {
  // Unchanged, wording included: this is what a locked school has always been
  // shown, and the division-wide cases are built to look like it rather than to
  // introduce a second way of saying "frozen".
  school: {
    kind: "school",
    title: "Your submission is locked",
    description:
      "Everything below is read-only. Contact the division office if you need a change.",
    icon: "lock",
  },
  global: {
    kind: "global",
    title: "Submissions are closed division-wide",
    description:
      "The division office has closed submissions for every school, so your school paper, roster and entries are read-only. Nothing you have already saved is lost. Contact the division office if you believe this is a mistake.",
    icon: "lock",
  },
  unavailable: {
    kind: "unavailable",
    title: "Submissions are on hold",
    description:
      "The division-wide lock setting could not be read, so no school can save anything at the moment. Nothing you have already saved is lost. Please try again in a few minutes, and contact the division office if it keeps happening.",
    icon: "alert",
  },
};

const ENTRIES_NOTES: Record<SchoolLockErrorKind, string> = {
  // Unchanged.
  school: "Your submission is locked. Contact the division office if you need a change.",
  global: "Submissions are closed division-wide. Nothing can be saved until they reopen.",
  unavailable: "Saving is on hold division-wide. Please try again in a few minutes.",
};

/**
 * What `/entry` shows, given the school's own lock and the division-wide switch.
 *
 * One banner, never two. The order below is "whichever fact will still be true
 * when the reader acts on it":
 *
 *   1. A division-wide freeze first, and for the reason the trigger reports it
 *      first — while it holds, "contact the division office to reopen your
 *      submission" is advice that would achieve nothing.
 *   2. Then the school's own lock, which outlives an unreadable setting: repairing
 *      `app_settings` would leave this school exactly as locked as it is now, so
 *      "try again in a few minutes" would be a lie told to a school that needs
 *      the division office.
 *   3. Then the unreadable setting, the only one of the three expected to clear
 *      by itself.
 */
export function entrySubmissionLock(input: {
  /** `paperFlow.submissionLocked` — `schools.submission_locked_at`, untouched by 0022. */
  schoolLocked: boolean;
  global: GlobalSubmissionsFreeze;
}): EntrySubmissionLock {
  const kind: SchoolLockErrorKind | null =
    input.global === "locked"
      ? "global"
      : input.schoolLocked
        ? "school"
        : input.global === "unavailable"
          ? "unavailable"
          : null;

  if (!kind) return { readOnly: false, banner: null, entriesNote: null };

  return { readOnly: true, banner: BANNERS[kind], entriesNote: ENTRIES_NOTES[kind] };
}
