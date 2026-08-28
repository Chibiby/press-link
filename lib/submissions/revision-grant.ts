/**
 * Revision grants: one school, some of its work, until a time.
 *
 * A grant is a row in `revision_grants` from migration 0031, read beside the
 * division-wide flag and never written into `schools`. This module holds the
 * shape both pages read that row into, the copy derived from it, and the single
 * predicate that decides whether a grant is live.
 *
 * Nothing here enforces anything. `revision_allows()` answers that question
 * again inside the database, on every school-side write, from `now()` and the row
 * itself — and that is the only answer that decides whether a write lands. What
 * this module decides is what the admin table and `/entry` *claim*. The
 * distinction is not academic: the countdown on the school's banner ticks in a
 * browser whose clock may be minutes out, and a browser must never be the thing
 * that says a window is open.
 *
 * It fails closed for the same reason `revision_allows()` does. A lock that fails
 * open is a bug; a *grant* that fails open is the same bug wearing the other hat,
 * so every unreadable value here reads as "not granted" rather than "granted".
 */

/**
 * The three surfaces a grant can cover, in the order every list of them renders.
 *
 * Not an arbitrary carve-up of a school's work: it is the seam the schema already
 * has. The seven guarded tables reach a school by three routes covered by three
 * guard functions, so a surface-scoped grant is one condition per function.
 * Per-entry grants were considered and rejected with the design — they need a
 * join table and an `entry_id` lookup inside `reject_locked_entry_link()`, and
 * the office's actual request is "let them fix their entries", not "let them fix
 * entry #4".
 *
 * The tuple is the source of order for {@link RevisionGrant.surfaces},
 * {@link validateGrantInput} and every sentence built from a set of surfaces, so
 * the same grant reads identically in the admin row, the modal and the school's
 * banner. A `Set` or a bare `string[]` would let the order follow whichever
 * checkbox the admin happened to click first, and the list would reshuffle
 * between two renders of one unchanged grant.
 */
export const REVISION_SURFACES = ["paper", "roster", "entries"] as const;

export type RevisionSurface = (typeof REVISION_SURFACES)[number];

/**
 * The short names, for the admin table cell and the modal's checkbox labels.
 *
 * Deliberately the office's vocabulary rather than the school's: this is the
 * reader who is granting, sees 336 rows at a time and needs the cell narrow.
 * `/entry` writes its own sentences from these lowercased — see
 * {@link surfaceList} — because a school reads "your school paper", not a column
 * heading.
 */
export const SURFACE_LABEL: Record<RevisionSurface, string> = {
  paper: "School paper",
  roster: "Roster",
  entries: "Entries",
};

/**
 * What each surface actually reaches, under its checkbox in the modal.
 *
 * The labels alone are not enough to grant safely: "School paper" does not say
 * that the contest answer — `set_paper_participation()`, the one non-trigger
 * write path, guarded at `paper` since 0023 — rides along with it, and an admin
 * who unchecks the box expecting the school can still answer the question would
 * be wrong. Each line names the tables in the reader's words instead.
 */
export const SURFACE_DETAIL: Record<RevisionSurface, string> = {
  paper: "Paper details, the contest answer and the paper staff.",
  roster: "Participants and coaches.",
  entries: "Every entry and its line-up.",
};

/**
 * The row as PostgREST hands it over: snake case, timestamps as strings, nothing
 * checked.
 *
 * Kept as a named wire shape rather than parsed at the edge of the select,
 * because the parse is {@link activeGrant} and there is exactly one of it. A
 * loader that shaped the row itself would be a second place deciding what "live"
 * means, and the two would drift the first time the boundary was argued about.
 */
export interface RawRevisionGrant {
  id: string;
  expires_at: string;
  granted_at: string;
  revoked_at: string | null;
  allow_paper: boolean;
  allow_roster: boolean;
  allow_entries: boolean;
}

/**
 * A live grant, as the app carries it. There is no `revoked_at` and no "expired"
 * variant on purpose: a revoked or expired row is not a grant in a weaker state,
 * it is nothing at all, and the only way to hold one is to have gone around
 * {@link activeGrant}.
 *
 * `expiresAt` stays the raw ISO string. The countdown needs the instant, not the
 * rendering, and the rendering is pinned to the server — see
 * {@link formatExpiry}.
 */
export interface RevisionGrant {
  id: string;
  expiresAt: string;
  grantedAt: string;
  /** Non-empty, deduped, in {@link REVISION_SURFACES} order. */
  surfaces: RevisionSurface[];
}

/**
 * Which boolean column carries which surface. One mapping, so the `allow_*`
 * spelling from 0031 appears once on this side of the wire; every other function
 * in this module works in surfaces.
 */
const ALLOW_COLUMN: Record<
  RevisionSurface,
  "allow_paper" | "allow_roster" | "allow_entries"
> = {
  paper: "allow_paper",
  roster: "allow_roster",
  entries: "allow_entries",
};

/**
 * The one place "is this grant live" is decided, from a row and an instant.
 *
 * Five ways to be nothing, and each is a state the database also treats as
 * nothing, because `revision_allows()` is the copy of this function that actually
 * refuses writes and the two disagreeing is the only failure mode that matters
 * here:
 *
 *   - No row. A school with no grant, or a read that came back empty.
 *   - `revoked_at` set. `admin_revoke_revision()` stamps rather than deletes, so
 *     the audit trail of what was granted when survives; a stamped row is over.
 *   - `expires_at` unparseable. Fail closed: a timestamp this side cannot read is
 *     not evidence of a window.
 *   - `expires_at <= now`. **Exclusive**, matching `expires_at > now()` in
 *     `revision_allows()`. The two must agree exactly or the banner outlives the
 *     permission — the school reads "you can edit your entries" over a database
 *     that has already gone back to refusing them, which is the one direction of
 *     error that wastes the window it was meant to save. The boundary is tested
 *     in both directions for that reason.
 *   - No surface allowed. An empty grant permits nothing, so it is not a grant.
 *     0031 makes it unrepresentable with a CHECK; this reads a row that got there
 *     anyway as the nothing it is, rather than announcing a window over an empty
 *     list.
 *
 * `now` is a parameter and never `new Date()` inside. The caller is a server
 * render with one instant for the whole page, and a function that read the clock
 * itself could decide a grant was live for the banner and expired for the
 * read-only flags in the same response.
 */
export function activeGrant(
  row: RawRevisionGrant | null | undefined,
  now: Date,
): RevisionGrant | null {
  if (!row) return null;
  // `!= null` rather than `!== null`: any value present means revoked, and an
  // absent field on an untrusted row is not a live grant either.
  if (row.revoked_at != null) return null;
  // An unusable clock cannot establish a window. Unreachable from a server render,
  // and cheaper than the bug it forecloses.
  if (Number.isNaN(now.getTime())) return null;

  const expires = new Date(row.expires_at);
  if (Number.isNaN(expires.getTime())) return null;
  if (expires.getTime() <= now.getTime()) return null;

  // Derived from the tuple rather than from the row's own field order, which is
  // where both the ordering and the deduplication guarantee come from for free.
  // `=== true` because this is wire data: a null or a string "t" is not a grant.
  const surfaces = REVISION_SURFACES.filter((surface) => row[ALLOW_COLUMN[surface]] === true);
  if (surfaces.length === 0) return null;

  return {
    id: row.id,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    surfaces,
  };
}

/**
 * Whether a grant covers one surface.
 *
 * Trivial, and it exists anyway: it is the predicate `entrySubmissionLock()`
 * asks three times per render, and inlining `grant?.surfaces.includes(s) ?? false`
 * at each of them would put the null handling — the part that is easy to get
 * wrong — in three places instead of one.
 */
export function grantAllows(
  grant: RevisionGrant | null,
  surface: RevisionSurface,
): boolean {
  return !!grant && grant.surfaces.includes(surface);
}

/**
 * The expiry in division time. Time only, because a grant runs for at most a day
 * and "until 4:19 PM" is what the office said on the phone.
 *
 * Pinned to `Asia/Manila` for the reason `lock-state.ts` pins it: the server
 * clock is UTC and the division is eight hours ahead, so an unpinned formatter
 * prints the wrong time and, near midnight, the wrong day.
 *
 * Server-side only in practice, and this is the load-bearing half. The formatted
 * string is handed down to the client as a plain prop and never re-derived
 * there, because Node's ICU and the browser's disagree about the space before
 * "PM" — formatting the same instant in both is a hydration mismatch over a
 * character nobody can see. The countdown ticks from the raw `expiresAt`
 * instead, which is a number in both runtimes.
 *
 * A 24-hour window can land on the following day, and this prints no date for it.
 * That is accepted rather than overlooked: the countdown beside it is what
 * resolves the ambiguity, and a date on the other five presets would be noise.
 */
const EXPIRES_AT = new Intl.DateTimeFormat("en-PH", {
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

/** The expiry in division time, or null when there isn't a usable one. */
export function formatExpiry(at: string | null | undefined): string | null {
  if (!at) return null;

  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return null;

  return EXPIRES_AT.format(when);
}

const MS_PER_MINUTE = 60_000;

/**
 * How long is left, short enough to sit inside a banner: "29 minutes", "1 hour 5
 * minutes", "under a minute", "expired".
 *
 * **Rounds down, never to nearest.** A school told it has 30 minutes when it has
 * 29 and a half loses the last save, and that is the only direction of error that
 * costs it work; being told 29 when it has 29:59 costs it nothing. "under a
 * minute" exists for the same reason — rounding the final seconds up to "1
 * minute" would promise time that has already gone.
 *
 * Seconds are deliberately not shown. A ticking second counter is what makes a
 * deadline feel like a countdown to be raced, and the window is generous by
 * design; the minute figure is what the school acts on.
 *
 * "expired" at and past the boundary, exclusive, agreeing with
 * {@link activeGrant} and with `revision_allows()`. An unparseable expiry reads
 * as expired for the same fail-closed reason: this label must never be the thing
 * that claims a window nobody can verify.
 */
export function remainingLabel(expiresAt: string, now: Date): string {
  const expires = new Date(expiresAt).getTime();
  const from = now.getTime();
  if (Number.isNaN(expires) || Number.isNaN(from)) return "expired";

  const left = expires - from;
  if (left <= 0) return "expired";

  const minutes = Math.floor(left / MS_PER_MINUTE);
  if (minutes === 0) return "under a minute";

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "minute" : "minutes"}`);

  return parts.join(" ");
}

/**
 * "entries", "roster and entries", "school paper, roster and entries" — the
 * surfaces as prose, mid-sentence.
 *
 * Exported because `/entry` builds its own sentence from the same list and must
 * not build a second list format to do it; `school-lock.ts` is the only other
 * caller. The comma-and shape restates `joinNouns()` from
 * `lib/dashboard/activity-sessions.ts` rather than importing it — that helper is
 * private to a module owned elsewhere, the same reason
 * `lib/schools/validate-new-school.ts` restates its numeric-ID pattern.
 *
 * `Intl.ListFormat` would produce the same three strings and was rejected: it is
 * locale data, so the separator can change under an ICU upgrade, and this list is
 * embedded in copy the tests assert character for character.
 *
 * Re-filtered through {@link REVISION_SURFACES} rather than mapped in place, so a
 * caller's ordering — or a duplicate — cannot reach the sentence.
 */
export function surfaceList(surfaces: readonly RevisionSurface[]): string {
  const parts = REVISION_SURFACES.filter((surface) => surfaces.includes(surface)).map(
    (surface) => SURFACE_LABEL[surface].toLowerCase(),
  );

  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The admin's one-liner under the Submission cell: "Revision open until 4:19 PM —
 * school paper, roster and entries."
 *
 * Takes the formatted label rather than formatting inside, so the page formats
 * once per row and the same string reaches the cell, the modal's heading and the
 * revoke confirmation. Two calls to {@link formatExpiry} in one render cannot
 * disagree, but three renderings of one grant reading differently by a minute is
 * the kind of thing that gets reported as a bug in the grant itself.
 *
 * A missing label says so instead of guessing a time, the way
 * `describeLockStamp()` handles the same case: unreachable while 0031's `not
 * null` holds, so it is stated plainly rather than papered over.
 */
export function describeGrant(grant: RevisionGrant, expiryLabel: string | null): string {
  const scope = surfaceList(grant.surfaces);

  if (!expiryLabel) {
    return `Revision open, with no expiry time recorded against it — ${scope}.`;
  }

  return `Revision open until ${expiryLabel} — ${scope}.`;
}

/**
 * The durations the modal offers, shortest first.
 *
 * Six presets and no free-text field. The office's request is measured in "give
 * them half an hour", never in 37 minutes, and a typed number is a way to grant
 * 4320 minutes by holding a key down — which the RPC would clamp to 1440 without
 * saying so, leaving the admin's screen and the database disagreeing about when
 * the window shuts. 24 hours is the top preset because it is the range bound in
 * both places.
 */
export const DURATION_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "24 hours" },
];

/**
 * Long enough for a school to be phoned back and fix one thing, short enough that
 * an admin who forgets to revoke has not reopened the school for the afternoon.
 */
export const DEFAULT_DURATION_MINUTES = 30;

/** The range 0031's RPC clamps to. Restated here so the action refuses what the
 * database would silently narrow — a clamp the admin cannot see is worse than an
 * error they can. */
const MIN_MINUTES = 1;
const MAX_MINUTES = 1440;

export type GrantInputResult =
  | { error: string }
  | { surfaces: RevisionSurface[]; minutes: number };

/**
 * Checks what the grant modal posted, or explains the first problem found.
 *
 * Both fields arrive as `unknown` and are treated as hostile, because a Server
 * Action is a public POST endpoint: the modal is one caller, not the only
 * possible one, and nothing about the form's markup reaches the handler. So
 * `surfaces` is checked for being an array at all before anything is read out of
 * it, unrecognised members are dropped rather than passed through to a column
 * lookup, and `minutes` is checked for being an integer in range rather than
 * coerced — `Number("30")` succeeding is how a string that should have been
 * rejected becomes a valid duration, and `Number("")` is 0.
 *
 * Order mirrors the modal: the checkboxes are above the duration, so the first
 * error names the first control an admin's eye would reach.
 *
 * This is the outer of two fences and not the load-bearing one. 0031's RPC
 * re-checks the admin, clamps the minutes and refuses an empty scope with a CHECK,
 * because the last line has to be inside the database.
 */
export function validateGrantInput(input: {
  surfaces: unknown;
  minutes: unknown;
}): GrantInputResult {
  // Read into a const before the check: narrowing a parameter property does not
  // survive into the callback below, and `as` there would defeat the point of
  // having checked.
  const requested = input.surfaces;
  if (!Array.isArray(requested)) {
    return { error: "Choose at least one thing the school may revise." };
  }

  // Filtered from the tuple, not from the input, so the result is ordered, deduped
  // and provably one of the three — the value that reaches `allow_paper` and its
  // two siblings can only have come from here.
  const surfaces = REVISION_SURFACES.filter((surface) => requested.includes(surface));
  if (surfaces.length === 0) {
    return { error: "Choose at least one thing the school may revise." };
  }

  const { minutes } = input;
  if (
    typeof minutes !== "number" ||
    !Number.isInteger(minutes) ||
    minutes < MIN_MINUTES ||
    minutes > MAX_MINUTES
  ) {
    return { error: "Choose how long the window stays open, up to 24 hours." };
  }

  return { surfaces, minutes };
}
