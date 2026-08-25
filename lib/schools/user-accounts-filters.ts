import { matchesQuery } from "@/lib/search/matches-query";
import { SEARCH_PARAM, searchParamValue } from "@/lib/search/filter-params";

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
}

export interface UserAccountRow {
  schoolId: string;
  schoolName: string;
  schoolIdNumber: string;
  districtId: string;
  districtName: string;
  hasLogin: boolean;
  lockedAt: string | null;
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
  }));
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
