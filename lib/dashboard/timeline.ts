export type TimelineState = "completed" | "in-progress" | "unavailable";

export type TimelineKey =
  | "registration"
  | "judging-1"
  | "judging-2"
  | "tabulation"
  | "results";

export interface TimelineStep {
  key: TimelineKey;
  label: string;
  state: TimelineState;
  /** Display text for the state chip: "COMPLETED", "IN PROGRESS", "Not yet available". */
  stateLabel: string;
  detail: string;
}

export interface TimelineInput {
  /** Schools with `submission_locked_at` not null. */
  schoolsLocked: number;
  /** Schools holding at least one entry whose `submission_locked_at` is null. */
  schoolsOpenWithEntries: number;
  /** Total rows in `entries`. */
  entries: number;
  /**
   * Whether school-side writes are being refused division-wide — the switch
   * `app_settings.submissions_locked` from migration 0022, and every state in
   * which that flag cannot be read. While writes are refused, none of the two
   * counts above can change, so this closes registration on its own.
   *
   * The caller passes `submissionsWritesRefused()` from
   * `lib/submissions/lock-state.ts`, which answers true for an unreadable flag as
   * well as a locked one. That is the honest mapping, not a defensive one:
   * `submissions_locked_globally()` fails closed and raises rather than returning
   * false, so a flag nobody can read refuses every school-side write exactly as a
   * locked one does. Its one false case among the unknowns is a database that has
   * never had 0022 applied, where no trigger consults a flag at all.
   */
  globallyLocked: boolean;
}

export interface Timeline {
  steps: TimelineStep[];
  registrationClosed: boolean;
  /** The COMPETITION STATUS pill label. */
  statusPill: string;
}

/**
 * The four steps after registration. Each is rendered in the comp's position and
 * says what it is waiting for, rather than showing a `PENDING` chip that would
 * imply a judging pipeline exists. Nothing in this database scores an entry.
 */
const PENDING_STEPS: { key: TimelineKey; label: string; detail: string }[] = [
  {
    key: "judging-1",
    label: "Judging Round 1",
    detail: "Needs judge accounts and a scoring schema per event type.",
  },
  {
    key: "judging-2",
    label: "Judging Round 2",
    detail: "Opens once Round 1 scores are recorded.",
  },
  {
    key: "tabulation",
    label: "Tabulation",
    detail: "Needs Round 1 and Round 2 scores before it can rank anything.",
  },
  {
    key: "results",
    label: "Final Results",
    detail: "Publishes after tabulation is reviewed and certified.",
  },
];

const UNAVAILABLE_LABEL = "Not yet available";

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function buildTimeline(input: TimelineInput): Timeline {
  // Registration is closed only when locking has actually happened AND no school
  // holding an entry is still open. Comparing `schoolsLocked` against the number
  // of active schools would be wrong: a school can lock with zero entries, so
  // locked can exceed active while active schools are still submitting.
  const everySchoolFinished =
    input.schoolsLocked > 0 && input.schoolsOpenWithEntries === 0;

  // The division-wide switch closes registration by itself, including with
  // nothing locked per school. Anything else would print "Registration Open"
  // above a division in which not one school can save a thing — the one lie this
  // pill must never tell.
  const registrationClosed = input.globallyLocked || everySchoolFinished;

  const registration: TimelineStep = {
    key: "registration",
    label: "Registration",
    state: registrationClosed ? "completed" : "in-progress",
    stateLabel: registrationClosed ? "COMPLETED" : "IN PROGRESS",
    // The per-school counts stay in the line even while the switch is on: they
    // are what an admin needs to see to know what turning it off would reopen.
    detail: `${count(input.schoolsLocked, "school", "schools")} locked · ${count(
      input.entries,
      "entry",
      "entries",
    )} submitted${input.globallyLocked ? " · locked division-wide" : ""}`,
  };

  return {
    steps: [
      registration,
      ...PENDING_STEPS.map((step) => ({
        ...step,
        state: "unavailable" as const,
        stateLabel: UNAVAILABLE_LABEL,
      })),
    ],
    registrationClosed,
    statusPill: registrationClosed ? "Registration Closed" : "Registration Open",
  };
}
