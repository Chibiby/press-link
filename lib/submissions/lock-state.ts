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
 * Why the lock state could not be established. Neither case is evidence that the
 * lock is off.
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
   * The read itself failed. Everything from a network blip to a database that has
   * never had 0022 applied arrives under this one reason, which is why it says
   * only how little was learned. What is happening to school-side writes
   * meanwhile is carried separately, by `writesRefused`.
   */
  | "unreadable";

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
       * Whether school-side writes are being refused right now, as far as that
       * can be established at all.
       *
       * Normally true, because `submissions_locked_globally()` fails closed: it
       * raises 'submission lock state unavailable' rather than returning false
       * when it cannot positively read the flag. An unknown state is therefore a
       * refusing state, and the pill above it has to say so.
       *
       * False in one case only — the read failed because the table, the function
       * or the column is not there at all (`isMissingLockGuard()`). Then 0022 has
       * not reached this database, no trigger consults a flag, and every school
       * really can save.
       */
      writesRefused: boolean;
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
 * Whether school-side writes are being refused division-wide.
 *
 * The COMPETITION STATUS pill is derived from this, not from `state ===
 * "locked"`, because those are different questions. A flag nobody can read
 * refuses every school-side write exactly as a locked one does — the guard raises
 * instead of returning false — so both unknown cases answer true here unless the
 * guard itself is missing.
 */
export function submissionsWritesRefused(lock: SubmissionsLock): boolean {
  if (lock.state === "locked") return true;
  if (lock.state === "unknown") return lock.writesRefused;

  return false;
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
 * None of the three tells the admin the division is open on no evidence. That was
 * the old copy's bug: it answered *any* read failure with "nothing is frozen and
 * every school can save as usual", including a transient failure over a flag that
 * genuinely read `true` — the one reassurance a deadline cannot survive. The open
 * sentence now appears only where the error code says the switch is not installed
 * at all, and it names the evidence it stands on.
 */
export function describeUnknownLock(lock: SubmissionsLockUnknown): string {
  if (lock.reason === "no-row") {
    return "While that row is missing, every school-side save is being refused. Setting submissions open below puts the row back.";
  }

  if (lock.writesRefused) {
    return "The guards refuse every school-side save while the flag cannot be read, so the division is frozen whichever way the flag itself reads. Setting it explicitly below is what clears that.";
  }

  return "Nothing on this database consults a division-wide flag yet — the message above is the switch's own table or column reporting itself absent — so school-side saves are going through as usual. Neither button below can work until migration 0022 is applied.";
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

    // A read that failed is not evidence of either state, so both are offered and
    // neither is presumed. Offering only "open" is how a transient failure at a
    // deadline unfreezes a division that was deliberately frozen — the one
    // outcome this control must not make easy. `lockAction` keeps the rightmost
    // slot it holds while submissions are open, so the click that freezes every
    // school is in the same place whichever state the dialog was opened over.
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
