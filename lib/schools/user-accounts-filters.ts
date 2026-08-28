import { matchesQuery } from "@/lib/search/matches-query";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";
import type { GlobalSubmissionsFreeze } from "@/lib/submissions/school-lock";
import type { SubmissionsLock } from "@/lib/submissions/lock-state";
import type { RawRevisionGrant, RevisionGrant } from "@/lib/submissions/revision-grant";

/**
 * Which rows /admin/users shows, and what to say when that is none of them.
 *
 * Mirrors `lib/schools/school-registry-filters.ts` in shape — the row mapper,
 * the search predicate on top of it, and the empty-state sentence — but this
 * page has no status union to defer to: "has a login" and "submission locked"
 * are each a plain boolean read straight off the school row, not a derived
 * registry status. Kept in `lib/schools/` beside the registry filters, the
 * other module about what a school *is* rather than what it has submitted.
 */

/**
 * A PostgREST embedded aggregate. `entries(count)` comes back as a one-element
 * array holding the count, not as a number, and as `[]` for a school with no
 * related rows at all — so both shapes have to be tolerated at the boundary
 * rather than asserted away with a cast.
 */
type EmbeddedCount = { count: number }[] | null;

/** A `schools` row joined to its district, as /admin/users fetches it. */
export interface RawUserAccountSchool {
  id: string;
  name: string;
  school_id_number: string;
  district_id: string;
  /** Null means the school has never had a login provisioned. */
  auth_user_id: string | null;
  /** Non-null means only an admin unlock can free the school's submission. */
  submission_locked_at: string | null;
  districts: { name: string } | null;
  /** `'undecided'` until the school answers the school-paper question. */
  paper_participation: string | null;
  /** How many entries the school has filed. */
  entries: EmbeddedCount;
  /** How many school-paper rows the school has saved. */
  school_papers: EmbeddedCount;
  /**
   * The school's revision grants from migration 0031, as an embedded array.
   *
   * An array because the foreign key runs the other way — many grants to one
   * school, and a school accumulates a revoked row for every window it has ever
   * been given. The page's select narrows the embed to `revoked_at is null`, and
   * `revision_grants_one_live` makes at most one row survive that, so this comes
   * back with zero or one element. `null` is tolerated for `EmbeddedCount`'s
   * reason: this is the wire, and asserting the shape away with a cast would only
   * move the failure somewhere less obvious.
   */
  revision_grants: RawRevisionGrant[] | null;
}

export interface UserAccountRow {
  schoolId: string;
  schoolName: string;
  schoolIdNumber: string;
  districtId: string;
  districtName: string;
  hasLogin: boolean;
  lockedAt: string | null;
  /**
   * Whether the school has started its submission at all.
   *
   * Three conditions, not one: an entry filed, a school-paper row saved, or the
   * paper question answered either way. A school that saved its paper details
   * and stopped has started — reporting it as having filed nothing would be a
   * lie about work its staff can see in their own dashboard. The Submission
   * column reads this to say "Closed" instead of "Locked" under a
   * division-wide lock: a school with nothing filed has nothing to reopen, so
   * "Locked" invites an admin to unlock something that does not exist.
   */
  hasFiledAnything: boolean;
  /**
   * The school's live-looking grant row, still in its wire shape.
   *
   * Deliberately **not** resolved to a {@link RevisionGrant} here. Deciding
   * whether a grant is live needs an instant, `activeGrant()` takes that instant
   * as a parameter rather than reading the clock, and this module maps rows — a
   * mapper that read `new Date()` would give each row its own "now", and two rows
   * in one table could then disagree about whether the same moment had passed.
   * The page owns the clock, calls `activeGrant()` once per render against one
   * `now`, and hands the result to {@link submissionCellState}.
   *
   * At most one element survives the page's `revoked_at is null` embed filter
   * under `revision_grants_one_live`, so this is the first element or null.
   */
  grant: RawRevisionGrant | null;
}

/** The first element's count, or 0 — see `EmbeddedCount`. */
function embeddedCount(raw: EmbeddedCount): number {
  if (!Array.isArray(raw) || raw.length === 0) return 0;
  return raw[0]?.count ?? 0;
}

/** The query's shape turned into the row shape the table reads. */
export function toUserAccountRows(raw: RawUserAccountSchool[]): UserAccountRow[] {
  return raw.map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    schoolIdNumber: row.school_id_number,
    districtId: row.district_id,
    districtName: row.districts?.name ?? "",
    hasLogin: row.auth_user_id !== null,
    lockedAt: row.submission_locked_at,
    hasFiledAnything:
      embeddedCount(row.entries) > 0 ||
      embeddedCount(row.school_papers) > 0 ||
      (row.paper_participation !== null && row.paper_participation !== "undecided"),
    // `?? null` rather than the bare index: PostgREST hands an empty embed back
    // as `[]`, and `[][0]` is `undefined`, which is not the same value the type
    // promises and not the value `activeGrant()`'s `!row` guard was written
    // against — it tolerates both, and the row should still carry exactly one of
    // them.
    grant: row.revision_grants?.[0] ?? null,
  }));
}

/**
 * What the Submission cell says about one school.
 *
 * A union rather than three booleans on the row, because the four are mutually
 * exclusive and the cell renders exactly one badge: two flags set at once is a
 * state the cell would have to invent a rendering for, and the invention would
 * happen in JSX where nothing in this repo can test it.
 */
export type SubmissionCellState = "open" | "locked" | "closed" | "revision";

/**
 * The dashboard's reading of the division-wide switch, as the Submission cell
 * needs it.
 *
 * Two modules describe the same flag for two readers. `/admin` reads it as
 * `SubmissionsLock`, which carries the stamp, the admin who set it and — on a
 * failure — how much that failure actually established; `/entry` reads it as
 * `GlobalSubmissionsFreeze`, three values and nothing else. The cell wants the
 * second, so the narrowing happens here, once, rather than as a ternary inside
 * the table.
 *
 * The `unknown` branch defers to `writes` rather than deciding for itself, and
 * that is the whole reason this is a function. `writes` is the field that already
 * distinguishes "the guard is standing over a flag it cannot read, and every
 * school-side write is being refused" from "the read failed in a way that says
 * nothing" — the second being the state of production while 0022 is unapplied,
 * where every school can save normally. Reading every failure as a freeze is the
 * bug `SubmissionsWrites` was introduced to fix, and it would come straight back
 * here as 336 rows announcing "Closed" over a division that is open.
 *
 * `undetermined` therefore reads as open, which also means no revision control
 * appears. That is the honest outcome: the buttons exist to reopen a school
 * inside a freeze this page has not established there is one of.
 */
export function globalFreezeFromLock(lock: SubmissionsLock): GlobalSubmissionsFreeze {
  if (lock.state === "locked") return "locked";
  if (lock.state === "unlocked") return "open";
  return lock.writes === "refused" ? "unavailable" : "open";
}

/**
 * Which of the four the cell shows, from the school's own lock, whether it has
 * filed anything, its live grant and the division-wide switch.
 *
 * Precedence, written the way `entrySubmissionLock()` writes its own, because
 * each rule sits where it does for a reason and the order is the whole function:
 *
 *   1. **A live grant first.** It is the only state with a deadline of its own
 *      and the only one an admin may want to shorten in the next few minutes, so
 *      it has to be the thing the row says. It also outranks both locks in the
 *      database — 0031's wrapper consults `revision_allows()` before either lock
 *      is looked at — and a row reading "Locked" over a school that is at this
 *      moment writing would be the page contradicting the guard.
 *   2. **Then "Closed", but only under the division-wide lock.** A school with
 *      nothing filed has nothing to reopen, so "Locked" beside an `Unlock` button
 *      invites an admin to unlock something that does not exist. Outside a
 *      division-wide lock this state does not exist at all: a school that has
 *      filed nothing is simply a school that has not started, its window is still
 *      open, and calling that "Closed" would report the deadline as having passed
 *      a school it has not passed. That pairing — nothing filed with the lock off
 *      is "open", nothing filed with the lock on is "closed" — is the one that is
 *      easy to get wrong, so it is tested in both directions.
 *   3. **Then either lock.** The school's own `submission_locked_at` and the
 *      division-wide switch produce the same cell, because they produce the same
 *      situation for the school: nothing can be written. They are not merged
 *      further up because rule 2 needs to know which of them is on.
 *   4. **Otherwise open.**
 *
 * `unavailable` counts as locked rather than as its own state. The guards are
 * refusing every school-side write at that moment — `submissions_locked_globally()`
 * raises rather than returning false — so the cell would be lying to call the row
 * open, and the page already explains the unreadable switch once, above the
 * table, rather than 336 times inside it.
 */
export function submissionCellState(input: {
  /** `schools.submission_locked_at`. Non-null means the school locked itself. */
  lockedAt: string | null;
  hasFiledAnything: boolean;
  /** Already resolved through `activeGrant()` against the page's single `now`. */
  grant: RevisionGrant | null;
  global: GlobalSubmissionsFreeze;
}): SubmissionCellState {
  if (input.grant) return "revision";

  const globallyFrozen = input.global !== "open";

  if (globallyFrozen && !input.hasFiledAnything) return "closed";
  if (input.lockedAt !== null || globallyFrozen) return "locked";

  return "open";
}

/**
 * The params this page reads.
 *
 * `UserAccountsFilters` rather than a shape declared on the page, so the page
 * and the filter bar it hands these to cannot disagree about a param's name —
 * a mistake with no symptom other than a control that silently does nothing.
 */
export interface UserAccountsFilters {
  [SEARCH_PARAM]?: string | string[];
  district?: string;
}

/**
 * `?q=alabel&q=maasim` resolves to an array, and the first value wins because
 * that is what `useSearchParams().get(SEARCH_PARAM)` returns in the filter
 * bar — the box and the table have to agree about which one they are showing.
 */
function firstValue(raw: string | string[] | undefined): string {
  if (raw === undefined) return "";
  if (Array.isArray(raw)) return raw.length > 0 ? raw[0] : "";
  return raw;
}

/** The typed query, trimmed, or null when the box is empty. */
export function userAccountsSearchQuery(filters: UserAccountsFilters): string | null {
  return searchParamValue(firstValue(filters[SEARCH_PARAM]));
}

/**
 * The rows the table shows: district first (a closed set with its own
 * dropdown), then the search box over the school's name and ID number — the
 * same two fields `/admin/schools` searches, for the same reason: they are
 * the only columns on this table a reader types a fragment of from memory.
 */
export function filterUserAccountRows(
  rows: UserAccountRow[],
  filters: UserAccountsFilters
): UserAccountRow[] {
  const query = userAccountsSearchQuery(filters) ?? "";
  const districtId = filters.district || null;

  return rows
    .filter((row) => !districtId || row.districtId === districtId)
    .filter((row) => matchesQuery([row.schoolName, row.schoolIdNumber], query));
}

export interface UserAccountsSummary {
  totalSchools: number;
  schoolsWithLogin: number;
  lockedCount: number;
}

/**
 * The two counts the page's subtitle prints: how many schools have a login,
 * and how many submissions are locked. Taken over every school on the roll,
 * not the filtered view — a search box narrowing the table to one district
 * must not also change what "214 of 332 schools have a login" means.
 */
export function summariseUserAccounts(rows: UserAccountRow[]): UserAccountsSummary {
  return {
    totalSchools: rows.length,
    schoolsWithLogin: rows.filter((row) => row.hasLogin).length,
    lockedCount: rows.filter((row) => row.lockedAt !== null).length,
  };
}

export interface UserAccountsEmptyState {
  /** What the table says in place of rows. Names the cause, never just "none". */
  message: string;
  /** Whether a control is narrowing the list, and so whether the page owes the reader a way back. */
  narrowed: boolean;
}

/**
 * What to render when the table has no rows. Three causes, because a reader
 * can only act on the one that applies to them — a search that matches
 * nothing is quoted back so a typo is spottable, and that must never be
 * confused with the roll itself being empty.
 */
export function userAccountsEmptyState(filters: UserAccountsFilters): UserAccountsEmptyState {
  const query = userAccountsSearchQuery(filters);
  const otherFilters = Boolean(filters.district);

  if (query && otherFilters) {
    return {
      message: `No schools match “${query}” with these filters.`,
      narrowed: true,
    };
  }
  if (query) {
    return { message: `No schools match “${query}”.`, narrowed: true };
  }
  if (otherFilters) {
    return { message: "No schools match this filter.", narrowed: true };
  }
  return { message: "No schools are on the division roll yet.", narrowed: false };
}
