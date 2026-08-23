/**
 * The division-wide submissions lock, as the app reads it.
 *
 * The switch itself is `app_settings.submissions_locked` from migration 0022 —
 * one row, `id = true`, flipped only through `admin_set_submissions_lock()`. This
 * module holds the shape the dashboard reads it into and the copy derived from
 * it, so both the server loader and the client control agree without either one
 * importing the other.
 *
 * Nothing here enforces anything. The lock is enforced by the trigger functions
 * in 0022, inside the database, on every school-side write. That is also why the
 * read is allowed to fail soft: what this module decides is what the dashboard
 * *claims*, never what any school is permitted to do.
 */

/**
 * Why the lock state could not be established. None of the three is evidence that
 * the lock is off.
 */
export type SubmissionsLockUnknownReason =
  /**
   * `app_settings` answered, but with no row for `id = true`. Serious: while
   * that row is missing, `submissions_locked_globally()` raises and *every*
   * school-side write is refused with 'submission lock state unavailable'.
   * Calling the RPC puts the row back, so the control stays usable here.
   */
  | "no-row"
  /**
   * The row is there and the flag on it is neither true nor false. 0022 declares
   * the column `not null default false`, so this is unreachable unless someone
   * altered it by hand — and it is kept apart from `unlocked` because a null is
   * not an open division, it is a column no reader should trust.
   */
  | "unusable-flag"
  /**
   * The read itself failed. Everything from a network blip to a database that has
   * never had 0022 applied arrives under this one reason, which is why it says
   * only how little was learned. What is happening to school-side writes
   * meanwhile is carried separately, by `writes`.
   */
  | "unreadable";

/**
 * What is happening to school-side writes division-wide, so far as this page has
 * established it. Three answers, because the read has three outcomes.
 *
 * `refused` and `open` each require positive evidence. `undetermined` is what is
 * left over, and it is a state in its own right rather than a lean towards
 * either: the version of this module that shipped had a boolean here and inferred
 * it from the *absence* of the codes that mean "0022 is not installed", so an
 * expired JWT, a statement timeout, a 5xx or a `fetch` that never landed all read
 * as `refused`. Production has 0022 unapplied and submissions genuinely open, so
 * on any of those failures the dashboard announced "Registration Closed" over a
 * division in which every school could save normally.
 *
 * All three are *reporting*, never enforcement. The 0022 triggers refuse
 * school-side writes, or do not, on their own reading of the flag inside the
 * database; nothing derived in this module is consulted by them, and no write
 * passes because of anything decided here. So `undetermined` is not a lock
 * failing open — there is no lock in this module to fail. It is the dashboard
 * declining to state what it does not know.
 */
export type SubmissionsWrites =
  /** Established: the flag reads locked, or the guard is standing over a flag it cannot read — it raises rather than returning false. */
  | "refused"
  /** Established: the flag reads open, or 0022 is not on this database at all, so nothing consults a flag. */
  | "open"
  /** Nothing established. The read failed in a way that says nothing about the flag or the guard. */
  | "undetermined";

export type SubmissionsLock =
  | {
      state: "locked";
      /** `submissions_locked_at`, ISO. Never null in practice — a CHECK ties it to the flag. */
      at: string | null;
      /** `submissions_locked_by`. Null when a script or migration flipped it with no auth.uid(). */
      by: string | null;
      /**
       * The locking admin's name, when it can be resolved. `admin_profiles` is
       * self-read under RLS, so this is non-null exactly when the admin who
       * locked it is the admin reading it.
       */
      byName: string | null;
    }
  | { state: "unlocked" }
  | {
      state: "unknown";
      reason: SubmissionsLockUnknownReason;
      /** The database's own words, shown verbatim to the admin. */
      detail: string;
      /**
       * What is happening to school-side writes meanwhile, and how much of that
       * the failure actually established. `no-row` proves `refused` from 0022's
       * own definition; `unusable-flag` proves nothing either way; for
       * `unreadable` it is `writesAfterFailedLockRead()` reading the error code.
       */
      writes: SubmissionsWrites;
    };

/** The unknown branch on its own, for the copy that only applies to it. */
export type SubmissionsLockUnknown = Extract<SubmissionsLock, { state: "unknown" }>;

/**
 * The error codes that mean the switch is absent rather than unreadable.
 *
 * Two dialects reach the client for the same condition, so both are listed: a
 * Supabase project answers for a table its schema cache has never seen with
 * `PGRST205` and never reaches Postgres at all, while a direct statement (or an
 * older PostgREST) comes back with the SQLSTATE instead. The column codes belong
 * here for the environment 0022's own header describes — the one where 0010 never
 * ran and the 0001 table is still standing with only `submissions_locked` on it.
 * The dashboard's select asks for `submissions_locked_at` too, so that database
 * answers "no such column", and it is as free of guard triggers as one with no
 * table at all.
 */
const MISSING_GUARD_CODES: ReadonlySet<string> = new Set([
  "42P01", // undefined_table
  "42883", // undefined_function
  "42703", // undefined_column
  "PGRST205", // table missing from the schema cache
  "PGRST202", // function missing from the schema cache
  "PGRST204", // column missing from the schema cache
]);

/**
 * True when a failed read means migration 0022 is not on this database, rather
 * than that reading a switch which *is* there went wrong.
 *
 * That distinction is the whole difference between "every write is being
 * refused" and "every school can save", and it cannot be taken from the message
 * text: the text is PostgREST's prose and it changes between versions. The code
 * does not.
 */
export function isMissingLockGuard(code: string | null | undefined): boolean {
  return !!code && MISSING_GUARD_CODES.has(code);
}

/**
 * SQLSTATE classes that mean no answer about the flag ever came back: the
 * connection failed (08), the server was out of room (53), the statement was
 * cancelled or the server is shutting down or not yet accepting connections (57 —
 * `57014` is the statement timeout), the system itself failed (58), or the fault
 * was reported as internal and unclassified (XX). A read that ends in one of
 * these says nothing about whether a guard is standing behind it.
 */
const UNDETERMINED_SQLSTATE_CLASSES: ReadonlySet<string> = new Set([
  "08",
  "53",
  "57",
  "58",
  "XX",
]);

/** A SQLSTATE is five characters of digits and capitals. `PGRST301` is not one. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * What a failed read of the switch establishes about school-side writes.
 *
 * Both definite answers stand on positive evidence, which is the whole point of
 * the function: neither state may be inferred from the mere absence of the
 * other's codes.
 *
 * - The six codes in `isMissingLockGuard()` say the table, function or column is
 *   not there. Nothing consults a flag on such a database, so writes are `open`.
 * - Any other SQLSTATE says the statement reached Postgres and Postgres raised
 *   over objects that do exist — 0022 is installed and the flag could not be
 *   read, which is precisely the case `submissions_locked_globally()` answers by
 *   raising instead of returning false. Writes are `refused`.
 * - Everything else establishes nothing. A PostgREST code is PostgREST's own
 *   answer rather than Postgres's (`PGRST301`, an expired JWT, never reaches the
 *   flag); a class 57 SQLSTATE means Postgres never finished answering; a dropped
 *   connection, a proxy 5xx or a `fetch` that failed arrives with no `code` at
 *   all. These are the ordinary production failures, and they are evidence of
 *   neither state.
 */
export function writesAfterFailedLockRead(
  code: string | null | undefined,
): SubmissionsWrites {
  if (isMissingLockGuard(code)) return "open";
  if (!code || !SQLSTATE.test(code)) return "undetermined";
  if (UNDETERMINED_SQLSTATE_CLASSES.has(code.slice(0, 2))) return "undetermined";

  return "refused";
}

/**
 * Whether school-side writes are being refused division-wide — and whether that
 * is known at all.
 *
 * The COMPETITION STATUS pill is derived from this, not from `state === "locked"`,
 * because those are different questions: a flag the guard cannot read refuses
 * every school-side write exactly as a locked one does. It does not return a
 * boolean, because a boolean is what forced a third situation into one of two
 * renderings and made a timeout read as a frozen division.
 */
export function submissionsWrites(lock: SubmissionsLock): SubmissionsWrites {
  if (lock.state === "locked") return "refused";
  if (lock.state === "unknown") return lock.writes;

  return "open";
}

/**
 * The timezone is pinned for the same reason `app/admin/(shell)/page.tsx` pins
 * it: the server clock is UTC and the division office is eight hours ahead, so an
 * unpinned formatter prints the wrong day.
 *
 * Server-side only in practice. `describeLockStamp()` is called on the page and
 * its result handed to the dialog as a plain string, because Node's ICU and the
 * browser's disagree about the space before "PM" — formatting the same instant in
 * both is a hydration mismatch over a character nobody can see.
 */
const LOCKED_AT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

/** The lock timestamp in division time, or null if there isn't a usable one. */
export function formatLockedAt(at: string | null | undefined): string | null {
  if (!at) return null;

  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return null;

  return LOCKED_AT.format(when);
}

/**
 * "Locked since … by …", or null when there is no lock to attribute.
 *
 * Reads as *since*, not *at*, because the stamp keeps its first value when the
 * lock is re-applied: `admin_set_submissions_lock` coalesces it, so a second
 * click cannot rewrite who locked the division or when.
 */
export function describeLockStamp(lock: SubmissionsLock): string | null {
  if (lock.state !== "locked") return null;

  const when = formatLockedAt(lock.at);
  if (!when) {
    // Unreachable while the 0022 CHECK holds, which is why it says so plainly
    // rather than guessing a time.
    return "Locked division-wide, with no time recorded against it.";
  }

  if (lock.byName) return `Locked since ${when} by ${lock.byName}.`;
  if (lock.by) return `Locked since ${when} by another administrator.`;

  return `Locked since ${when}, with no administrator recorded against it.`;
}

/**
 * What is happening to school-side writes while the state is unknown, in one
 * sentence under the database's own message.
 *
 * None of these tells the admin the division is open on no evidence, and none of
 * them tells the admin it is shut on no evidence either. The copy has been wrong
 * in both directions: it first answered *any* read failure with "nothing is
 * frozen and every school can save as usual", including a transient failure over
 * a flag that genuinely read `true`; the repair for that then answered every
 * failure with "the division is frozen whichever way the flag reads", including
 * the timeouts and expired sessions that are most of them. A failure that
 * establishes nothing gets the last branch, which says exactly that.
 */
export function describeUnknownLock(lock: SubmissionsLockUnknown): string {
  if (lock.reason === "no-row") {
    return "While that row is missing, every school-side save is being refused. Setting submissions open below puts the row back.";
  }

  if (lock.reason === "unusable-flag") {
    return "The row is there, but the flag on it is neither true nor false, so this page cannot say which state the division is in. The guards read that same column; setting the state explicitly below writes a value they can read.";
  }

  if (lock.writes === "refused") {
    return "The guards refuse every school-side save while the flag cannot be read, so the division is frozen whichever way the flag itself reads. Setting it explicitly below is what clears that.";
  }

  if (lock.writes === "open") {
    return "Nothing on this database consults a division-wide flag yet — the message above is the switch's own table or column reporting itself absent — so school-side saves are going through as usual. Neither button below can work until migration 0022 is applied.";
  }

  return "That failure says nothing about the flag: an expired session, a cancelled statement or a connection that dropped all arrive this way, so this page cannot tell you which state the division is in. Only the reading is missing — the guards in the database are refusing school-side saves, or letting them through, exactly as they were before this page loaded. Setting the state explicitly below is what makes it certain.";
}

export interface SubmissionsLockAction {
  /** What the confirmation sends to `admin_set_submissions_lock(locked)`. */
  nextLocked: boolean;
  label: string;
  /** Destructive only where confirming actually freezes the division. */
  variant: "default" | "destructive";
}

export interface SubmissionsLockControl {
  /**
   * The button's own text. It names the *state* while the division is frozen and
   * the *action* while it is not, so the two can never be mistaken for each
   * other at a glance; the confirmation carries the verb either way.
   */
  label: string;
  /**
   * Destructive for the state that freezes every school — the one an admin needs
   * to notice from across the room. Outline otherwise, matching the other
   * errands in this row.
   */
  variant: "outline" | "destructive";
  icon: "lock" | "alert";
  /** The confirmation's heading. */
  title: string;
  /**
   * The confirmation's buttons, in render order after Cancel — so the last one
   * takes the rightmost slot, where this dialog's primary click has always been.
   *
   * One in every state that can be read, because there is exactly one thing to do
   * about a state you know. Two where it cannot be read: see below.
   */
  actions: SubmissionsLockAction[];
  cancelLabel: string;
}

/** Everything the header control renders, derived from the state it was handed. */
export function submissionsLockControl(lock: SubmissionsLock): SubmissionsLockControl {
  const lockAction: SubmissionsLockAction = {
    nextLocked: true,
    label: "Lock submissions",
    variant: "destructive",
  };

  if (lock.state === "locked") {
    return {
      label: "Submissions locked",
      variant: "destructive",
      icon: "lock",
      title: "Unlock submissions division-wide?",
      // Unlocking restores every school to its own lock and destroys nothing, so
      // it is not styled as though it did.
      actions: [{ nextLocked: false, label: "Unlock submissions", variant: "default" }],
      cancelLabel: "Keep them locked",
    };
  }

  if (lock.state === "unknown") {
    const openAction: SubmissionsLockAction = {
      nextLocked: false,
      label: "Set submissions open",
      variant: "default",
    };

    // A deleted singleton has one repair and only one: put the row back, open.
    // Open is the state every environment is already in, freezing a division that
    // was never frozen is not a repair, and hiding the button would remove the
    // only way out of a state that is refusing every school-side write right now.
    // Locking is one more click from there.
    if (lock.reason === "no-row") {
      return {
        label: "Lock state unknown",
        variant: "outline",
        icon: "alert",
        title: "Division-wide lock state unknown",
        actions: [openAction],
        cancelLabel: "Close",
      };
    }

    // A state that could not be read is not evidence of either state, so both are
    // offered and neither is presumed. Offering only "open" is how a transient
    // failure at a deadline unfreezes a division that was deliberately frozen —
    // the one outcome this control must not make easy. `lockAction` keeps the
    // rightmost slot it holds while submissions are open, so the click that
    // freezes every school is in the same place whichever state the dialog was
    // opened over.
    return {
      label: "Lock state unknown",
      variant: "outline",
      icon: "alert",
      title: "Division-wide lock state could not be read",
      actions: [openAction, lockAction],
      cancelLabel: "Close",
    };
  }

  return {
    label: "Lock submissions",
    variant: "outline",
    icon: "lock",
    title: "Lock submissions division-wide?",
    actions: [lockAction],
    cancelLabel: "Keep submissions open",
  };
}
