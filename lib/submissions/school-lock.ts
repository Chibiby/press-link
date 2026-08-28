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
 * 0022 refuse the write inside the database, on every school-side table, and 0031
 * is what lets one of them through again for one school; this is only how that
 * refusal — or that reprieve — gets explained.
 */
import {
  classifySubmissionLockError,
  type SubmissionLockErrorKind,
} from "./lock-errors";
import {
  REVISION_SURFACES,
  formatExpiry,
  grantAllows,
  surfaceList,
  type RevisionGrant,
  type RevisionSurface,
} from "./revision-grant";

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
 *
 * There is deliberately no fourth entry for a grant. These answer a write that
 * *failed*, and a write inside a granted surface succeeds; a write outside one
 * fails with the division-wide sentence, which `global` already answers
 * correctly. Copy along the lines of "that part was not reopened" would have to
 * guess which surface the caller was writing to from an error message that does
 * not say.
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

/**
 * A banner for one of the three frozen states — the shape `/entry` has rendered
 * since before grants existed, field for field.
 */
export interface FrozenLockBanner {
  kind: SchoolLockErrorKind;
  title: string;
  description: string;
  /** Mirrors the admin control: this picks the meaning, the page picks the component. */
  icon: "lock" | "alert";
}

/**
 * A banner for a live grant: the fourth state, and the only one that is good
 * news.
 *
 * It carries three fields the frozen banners have no use for, which is why it is
 * its own interface rather than three optional properties on the old one — an
 * optional `expiresAt` would be `undefined` in three states out of four and every
 * reader would have to decide what that meant.
 */
export interface RevisionGrantBanner {
  kind: "grant";
  title: string;
  description: string;
  /**
   * Its own icon rather than a borrowed one. `alert` is the fail-closed triangle
   * and means something is wrong; `lock` means the work is shut. This state is
   * neither, and it is the one state the school can act on, so putting a warning
   * sign over it would read as a fourth kind of trouble.
   */
  icon: "clock";
  /**
   * The surfaces that are actually writable, in {@link REVISION_SURFACES} order.
   * The description already names them; they are repeated as data because the page
   * may want to mark the panels it reopened, and re-deriving the list from the
   * sentence is not a thing anyone should have to do.
   */
  surfaces: RevisionSurface[];
  /**
   * Raw ISO. The countdown ticks from this, client-side, because an instant is a
   * number in both runtimes — see `formatExpiry()` for the mismatch that formatting
   * it twice causes.
   */
  expiresAt: string;
  /**
   * The same instant formatted on the server, in division time, already inside
   * `description`. Handed over separately as well so the page can put it beside
   * the countdown without formatting anything itself. Null only when the stamp is
   * unusable, which 0031's `not null` forecloses.
   */
  expiryLabel: string | null;
  /**
   * The grant's `id`, so the page can acknowledge the once-per-grant modal against
   * it in `localStorage`. A refresh must not re-nag, and a *new* grant must — a
   * boolean "seen the revision modal" flag cannot tell those two apart, which is
   * the whole reason the id travels.
   */
  grantId: string;
}

/**
 * The one banner at the top of the dashboard.
 *
 * A discriminated union rather than a second `grantBanner` field beside the first.
 * "One banner, never two" is the invariant this module has held since it was
 * written, and as a union the type holds it instead of the page remembering to:
 * two nullable fields would make "which do I render, and what if both are set" a
 * question at every call site, and the answer would get reimplemented in the
 * component — the exact duplication this module exists to prevent. `kind` was
 * already the discriminant; it gains a fourth value.
 */
export type EntryLockBanner = FrozenLockBanner | RevisionGrantBanner;

export interface EntrySubmissionLock {
  /**
   * One decision per surface: the school paper and the contest answer, the roster,
   * the entries. Each is read-only when every write behind it is being refused —
   * the 0022 guard triggers cover the tables, and 0023 gave
   * `set_paper_participation()` the same division-wide check, which was the one
   * write path that had slipped past it.
   *
   * A single boolean cannot survive migration 0031. A grant scoped to entries
   * alone reopens exactly one of these three, and one flag would have to answer
   * for all of them: read as open it would present the roster as editable over a
   * database still refusing every roster write, and read as frozen it would leave
   * the entries read-only that the office reopened on the phone. Three answers is
   * what the database actually has — one condition per guard function.
   *
   * The single exception is `lock_submission()`, still as 0011 defined it and
   * guarded by none of the three migrations. A school can lock itself mid-freeze,
   * so the page leaves that button alone rather than inventing an enforcement the
   * database does not have.
   */
  readOnly: Record<RevisionSurface, boolean>;
  /** The one banner at the top of the dashboard, or null when nothing is frozen. */
  banner: EntryLockBanner | null;
  /** Replaces the line under the Entries heading while entries are refused, or explains the window while they are not. */
  entriesNote: string | null;
}

const BANNERS: Record<SchoolLockErrorKind, FrozenLockBanner> = {
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
 * The line under the Entries heading while entries are open on a grant.
 *
 * It replaces the ordinary "Every contest your school is competing in", because
 * that sentence is true and useless here: the fact the school needs at the moment
 * it starts typing is that this is temporary. No time is named — the banner and
 * its countdown own that, and a minute figure baked into a server-rendered string
 * would be wrong by the time it was read.
 */
const GRANT_ENTRIES_NOTE =
  "The division office reopened your entries for a short time. Save each change before the window closes.";

/**
 * The grant banner, built from the grant and from what stayed frozen beside it.
 *
 * The frozen surfaces are named, not merely omitted. A partial grant that only
 * announced what was reopened would read as "your work is open again" to a school
 * whose roster is still refusing every write, and it would find that out from a
 * failed save — the copy exists precisely so it does not have to.
 *
 * The expiry is stated as a time and never as a duration. "You have 29 minutes" is
 * server-rendered prose that keeps claiming 29 minutes for as long as the page is
 * open; the clock time stays true, and the countdown that does move is the
 * component's job.
 */
function grantBanner(
  grant: RevisionGrant,
  readOnly: Record<RevisionSurface, boolean>,
): RevisionGrantBanner {
  const expiryLabel = formatExpiry(grant.expiresAt);
  // Not a guessed time. `describeLockStamp()` handles its own missing stamp the
  // same way, and here the sentence still has to read, so it names the event
  // rather than the clock.
  const until = expiryLabel ? `until ${expiryLabel}` : "until this window closes";

  const frozen = REVISION_SURFACES.filter((surface) => readOnly[surface]);
  const remainder = frozen.length
    ? ` Your ${surfaceList(frozen)} ${frozen.length === 1 ? "stays" : "stay"} read-only.`
    : "";

  return {
    kind: "grant",
    title: "The division office reopened your work",
    description: `You can edit your ${surfaceList(grant.surfaces)} ${until}. Anything you have not saved by then is refused.${remainder}`,
    icon: "clock",
    surfaces: grant.surfaces,
    expiresAt: grant.expiresAt,
    expiryLabel,
    grantId: grant.id,
  };
}

/**
 * What `/entry` shows, given the school's own lock, the division-wide switch and
 * whatever grant is live for this school.
 *
 * One banner, never two. The order below is "whichever fact will still be true
 * when the reader acts on it":
 *
 *   1. A live grant first. Of the four states it is the only one the school can
 *      act on, and it is the only one with a deadline of its own, so burying it
 *      under "submissions are closed division-wide" would spend the window the
 *      office opened. It is also the only announcement that is *more* true than
 *      the ones below it: while it holds, the guard consults the grant before it
 *      consults either lock.
 *   2. Then a division-wide freeze, for the reason the trigger reports it first —
 *      while it holds, "contact the division office to reopen your submission" is
 *      advice that would achieve nothing.
 *   3. Then the school's own lock, which outlives an unreadable setting: repairing
 *      `app_settings` would leave this school exactly as locked as it is now, so
 *      "try again in a few minutes" would be a lie told to a school that needs
 *      the division office.
 *   4. Then the unreadable setting, the only one of the four expected to clear by
 *      itself.
 *
 * Rules 2 to 4 are unchanged and still decide the *frozen* surfaces, which is why
 * a partial grant reads as a partial grant: the roster keeps the note the
 * division-wide freeze gives it while the entries carry the grant's.
 *
 * A grant beats the school's own lock as well as the division's, exactly as the
 * 0031 wrapper does — `revision_allows()` is tested before either lock is looked
 * at. The design's reason is that a grant is the office saying go ahead, and "also
 * press Unlock on that row" is a second step with no meaning behind it; the
 * school's `submission_locked_at` stays on file and takes effect again the moment
 * the window shuts.
 */
export function entrySubmissionLock(input: {
  /** `paperFlow.submissionLocked` — `schools.submission_locked_at`, untouched by 0022. */
  schoolLocked: boolean;
  global: GlobalSubmissionsFreeze;
  /**
   * The school's live grant from `activeGrant()`, or null. Optional, and absent
   * behaves identically to today on every surface: callers written before 0031
   * keep their exact behaviour, and a database without the table reads as no
   * grant rather than as a broken page.
   */
  grant?: RevisionGrant | null;
}): EntrySubmissionLock {
  const kind: SchoolLockErrorKind | null =
    input.global === "locked"
      ? "global"
      : input.schoolLocked
        ? "school"
        : input.global === "unavailable"
          ? "unavailable"
          : null;

  // A grant over a division that is not frozen reopens nothing, so it is not
  // announced. The admin control only appears while the division-wide lock is on,
  // but a grant outlives an unlock — the office lifts the deadline and the row
  // stays live for another twenty minutes — and "the division office reopened your
  // work" over a school that was never shut is a notice about nothing.
  if (!kind) {
    return {
      readOnly: { paper: false, roster: false, entries: false },
      banner: null,
      entriesNote: null,
    };
  }

  // An empty grant permits nothing, so it is not announced as one. `activeGrant()`
  // refuses to build one and 0031's CHECK makes it unstorable; this is the third
  // fence, because "you can edit your " followed by nothing is a worse banner than
  // the frozen one it would have displaced.
  const grant = input.grant && input.grant.surfaces.length > 0 ? input.grant : null;

  const readOnly: Record<RevisionSurface, boolean> = {
    paper: !grantAllows(grant, "paper"),
    roster: !grantAllows(grant, "roster"),
    entries: !grantAllows(grant, "entries"),
  };

  if (grant) {
    return {
      readOnly,
      banner: grantBanner(grant, readOnly),
      // The note answers for the entries surface specifically, not for the grant as
      // a whole: a grant covering only the paper leaves entries as frozen as they
      // were, and this line is the only place the school is told so.
      entriesNote: readOnly.entries ? ENTRIES_NOTES[kind] : GRANT_ENTRIES_NOTE,
    };
  }

  return { readOnly, banner: BANNERS[kind], entriesNote: ENTRIES_NOTES[kind] };
}
