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
 * in 0022, inside the database, on every school-side write.
 */

/** Why the lock state could not be established. Both cases mean "do not claim it is off". */
export type SubmissionsLockUnknownReason =
  /**
   * `app_settings` answered, but with no row for `id = true`. Serious: while
   * that row is missing, `submissions_locked_globally()` raises and *every*
   * school-side write is refused with 'submission lock state unavailable'.
   * Calling the RPC puts the row back, so the control stays usable here.
   */
  | "no-row"
  /**
   * The read itself failed. The ordinary cause is that 0022 has not been applied
   * to this database yet, in which case the guard triggers do not consult a flag
   * at all and nothing is frozen.
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
    };

/**
 * The timezone is pinned for the same reason `app/admin/(shell)/page.tsx` pins
 * it: the server clock is UTC and the division office is eight hours ahead, so an
 * unpinned formatter prints the wrong day. Pinning also makes this safe to call
 * inside a client component — the server render and the browser render produce
 * the same string, whatever the reader's own timezone is, so there is no
 * hydration mismatch.
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
  /** What the confirmation sends to `admin_set_submissions_lock(locked)`. */
  nextLocked: boolean;
  /** The confirmation's heading. */
  title: string;
  confirmLabel: string;
  /** Destructive only where confirming actually freezes the division. */
  confirmVariant: "default" | "destructive";
  cancelLabel: string;
}

/** Everything the header control renders, derived from the state it was handed. */
export function submissionsLockControl(lock: SubmissionsLock): SubmissionsLockControl {
  if (lock.state === "locked") {
    return {
      label: "Submissions locked",
      variant: "destructive",
      icon: "lock",
      nextLocked: false,
      title: "Unlock submissions division-wide?",
      confirmLabel: "Unlock submissions",
      confirmVariant: "default",
      cancelLabel: "Keep them locked",
    };
  }

  if (lock.state === "unknown") {
    return {
      label: "Lock state unknown",
      variant: "outline",
      icon: "alert",
      // Open is the state every environment is already in, so the repair for a
      // missing settings row is to restore it as open rather than to freeze a
      // division that was never frozen. Locking is one more click from there.
      nextLocked: false,
      title: "Division-wide lock state unknown",
      confirmLabel: "Set submissions open",
      confirmVariant: "default",
      cancelLabel: "Close",
    };
  }

  return {
    label: "Lock submissions",
    variant: "outline",
    icon: "lock",
    nextLocked: true,
    title: "Lock submissions division-wide?",
    confirmLabel: "Lock submissions",
    confirmVariant: "destructive",
    cancelLabel: "Keep submissions open",
  };
}
