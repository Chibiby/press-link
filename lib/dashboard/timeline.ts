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
   * `app_settings.submissions_locked` — the division-wide override switch from
   * migration 0022. While it is on, every school-side write is refused whatever
   * the two counts above say, so it closes registration on its own.
   *
   * The caller passes `false` when the flag cannot be read. That is the honest
   * mapping: an unreadable flag is not evidence that registration has closed,
   * and it leaves this function's answer identical to what it was before the
   * switch existed.
   */
  globallyLocked: boolean;
}

export interface Timeline {
  steps: TimelineStep[];
  registrationClosed: boolean;
  /**
   * True when registration is closed because the division-wide switch is on
   * rather than because every school finished. Separate from
   * `registrationClosed` because the two are undone differently: one is a
   * setting an admin flips back, the other is sixteen schools' own decisions.
   */
  closedByGlobalLock: boolean;
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
    closedByGlobalLock: input.globallyLocked,
    statusPill: registrationClosed ? "Registration Closed" : "Registration Open",
  };
}
