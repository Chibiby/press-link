/**
 * What `/admin/audit-logs` shows, and what it does when the log is not there.
 *
 * The page is the *unaggregated* view of `activity_events`: one row per write,
 * newest first, whole division. `/admin/activity` folds a sitting into one
 * sentence — "Bagong Silang ES added 5 learners, 5 coaches and entry for 6
 * events" — which is the right unit for "what changed lately" and throws away the
 * per-row detail on purpose. This is where the discarded detail lives: which
 * learner, at which minute, in which session. Migration 0024 §3 says the same
 * thing from the other side, creating the `(at desc)` index for "the whole-table
 * newest-first read [that] belongs to the admin audit-logs page".
 *
 * The logic is here rather than in the page because nothing in this repo renders
 * a component under test, and two of these decisions are not cosmetic: whether a
 * failed fetch is "the migration has not been applied" or "something is wrong",
 * and what an unrecognised `kind` renders as.
 */

/** One `activity_events` row as the page selects it, school name embedded. */
export interface AuditEventRow {
  id: number | string;
  at: string;
  session_id: string | null;
  school_id: string | null;
  kind: string;
  label: string | null;
  /** `school:schools(name)`; null when the row carries no school, or the embed came back empty. */
  school: { name: string | null } | null;
}

/** One table row, every cell already a string the page can print. */
export interface AuditRow {
  id: string;
  /** "2:14 PM", Manila. */
  time: string;
  /** "Aug 23, 2026", Manila. */
  day: string;
  school: string;
  action: string;
  /** The subject's name as it stood at the time of the write. Null renders as a dash. */
  detail: string | null;
  /** "#3f2a1c9d", or null when the write carried no session claim. */
  session: string | null;
}

/**
 * Why a fetch came back without rows, which decides which of three pages renders.
 *
 * `absent` is not an error state. Migrations 0024 and 0025 are not applied in
 * production, so `activity_events` does not exist there and PostgREST answers
 * every select against it with `PGRST205`. That has to read as "not recording
 * yet", truthfully and without a 500 — the page is deployed ahead of its table on
 * purpose.
 */
export type AuditLogState = "ok" | "absent" | "failed";

/** The shape of the error PostgREST hands back, narrowed to what is decided on. */
export interface AuditFetchError {
  code?: string | null;
  message?: string | null;
}

/**
 * Codes that mean "this table is not in this database".
 *
 * `PGRST205` is the schema-cache miss PostgREST returns for an unknown table and
 * is the one production will produce. `42P01` is Postgres's own
 * `undefined_table`, which is what surfaces when the cache is stale in the other
 * direction — the table was dropped but is still cached. `PGRST200` is the
 * embed's version: the table exists but `school:schools(name)` cannot be
 * resolved, which happens in the window where 0024 has applied and the cache has
 * not reloaded. All three mean the same thing to a reader: nothing to show, and
 * nothing broken.
 */
const ABSENT_CODES: ReadonlySet<string> = new Set(["PGRST205", "PGRST200", "42P01"]);

const TIME_OF_DAY = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  // Pinned to Manila like every other formatter in this repo. Called only from a
  // server component, so the "2:14 PM" it returns is built once on the server and
  // shipped as HTML: Node's ICU and the browser's disagree about the space before
  // "PM", and formatting this on both sides of a hydration boundary is the
  // mismatch `SubmissionsLockDialog` documents.
  timeZone: "Asia/Manila",
});

const DAY = new Intl.DateTimeFormat("en-PH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Manila",
});

/**
 * The nine `activity_events_kind_check` values in a reader's words.
 *
 * Subject-less, because the school is its own column and "Bagong Silang ES —
 * Bagong Silang ES added a learner" is what a sentence per row would give.
 * `paper-updated` covers insert and update alike, which is 0025's choice: nobody
 * distinguishes creating the paper record from editing it.
 */
const ACTION: Record<string, string> = {
  "participant-added": "Learner added",
  "participant-removed": "Learner removed",
  "coach-added": "Coach added",
  "coach-removed": "Coach removed",
  "entry-submitted": "Entry submitted",
  "entry-withdrawn": "Entry withdrawn",
  "paper-updated": "School paper saved",
  "paper-answered": "School paper question answered",
  "submission-locked": "Submissions locked",
};

/** What a row with no school, or no name on its school, is called. */
const SCHOOL_FALLBACK = "Not recorded";

/**
 * Decide whether an error means the log is not installed, or that the read
 * genuinely failed.
 *
 * Anything unrecognised is `failed`, never `absent`: mislabelling a real fault as
 * "not recording yet" is how a broken audit log looks healthy, which is the one
 * failure this page must not have.
 */
export function auditLogState(error: AuditFetchError | null | undefined): AuditLogState {
  if (!error) return "ok";

  const code = (error.code ?? "").trim();
  if (ABSENT_CODES.has(code)) return "absent";

  // No code at all on some transport failures, so the message is read too. Narrow
  // wording on purpose — PostgREST's schema-cache miss says exactly this.
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("schema cache") || message.includes("does not exist")) return "absent";

  return "failed";
}

/** The one human phrase for a `kind`, falling back to the raw value. */
export function auditAction(kind: string): string {
  // An unrecognised kind is a widened vocabulary this file has not caught up
  // with (0024 §4 notes the two lists are one list in two places). Printing it
  // raw is ugly and complete; printing "Unknown" would hide a real row.
  return ACTION[kind] ?? kind;
}

/**
 * Shape the selected rows for the table, dropping any whose timestamp cannot be
 * read.
 *
 * The drop matches `mergeActivityFeed`'s filter: `at` is `not null` in the schema,
 * so this cannot happen against a real database, and the alternative is a row
 * whose only two time cells say "Invalid Date".
 */
export function buildAuditRows(raw: AuditEventRow[]): AuditRow[] {
  const rows: AuditRow[] = [];

  for (const row of raw) {
    const at = Date.parse(row.at);
    if (!Number.isFinite(at)) continue;

    const label = (row.label ?? "").trim();
    const session = (row.session_id ?? "").trim();

    rows.push({
      id: String(row.id),
      time: TIME_OF_DAY.format(at),
      day: DAY.format(at),
      school: (row.school?.name ?? "").trim() || SCHOOL_FALLBACK,
      action: auditAction(row.kind),
      detail: label === "" ? null : label,
      // The first block of the uuid, which is what a reader uses: it is enough to
      // see that four rows belong to one sitting, and the whole uuid in a cell
      // pushes every other column off a phone.
      session: session === "" ? null : `#${session.slice(0, 8)}`,
    });
  }

  return rows;
}

/**
 * "Showing the newest 100 of 4,213 recorded actions." — or the whole truth when
 * that is what is on screen.
 *
 * `total` is PostgREST's exact count, which is null when the count header was not
 * returned; in that case the sentence makes no claim about a total rather than
 * printing the number of rows twice.
 */
export function auditRangeLabel(shown: number, total: number | null): string {
  if (shown === 0) return "No actions recorded yet.";

  const actions = shown === 1 ? "1 action" : `${shown.toLocaleString("en-PH")} actions`;
  if (total === null) return `Showing the newest ${actions}.`;
  if (total <= shown) {
    return total === 1
      ? "Showing the only recorded action."
      : `Showing all ${total.toLocaleString("en-PH")} recorded actions.`;
  }

  return `Showing the newest ${actions} of ${total.toLocaleString("en-PH")} recorded.`;
}
