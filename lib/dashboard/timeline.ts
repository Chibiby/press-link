import {
  submissionsWrites,
  type SubmissionsLock,
} from "@/lib/submissions/lock-state";

export type TimelineState = "completed" | "in-progress" | "unknown" | "unavailable";

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

/**
 * Registration as this page is entitled to describe it.
 *
 * `unknown` is not a hedge between the other two — it is the answer when the
 * division-wide switch could not be read at all, which is a thing an admin has to
 * be told rather than have guessed at. Collapsing it onto `closed` is what put
 * "Registration Closed" over an open division on every statement timeout;
 * collapsing it onto `open` would be the same mistake pointing the other way, and
 * the more dangerous one at a deadline.
 */
export type RegistrationState = "open" | "closed" | "unknown";

export interface TimelineInput {
  /** Schools with `submission_locked_at` not null. */
  schoolsLocked: number;
  /** Schools holding at least one entry whose `submission_locked_at` is null. */
  schoolsOpenWithEntries: number;
  /** Total rows in `entries`. */
  entries: number;
  /**
   * The division-wide switch as the dashboard managed to read it —
   * `app_settings.submissions_locked` from migration 0022, or the reason it could
   * not be read.
   *
   * The whole state travels rather than a boolean because this function asks two
   * different questions of it. `submissionsWrites()` answers whether school-side
   * writes are being refused, which is what closes registration: a flag the guard
   * cannot read refuses every write exactly as a locked one does, and while writes
   * are refused neither count below can change. `state === "locked"` answers
   * whether an administrator actually locked anything, which is what the detail
   * line is allowed to claim. Deriving either here would be a second answer to a
   * question `lib/submissions/lock-state.ts` already answers.
   */
  submissionsLock: SubmissionsLock;
}

export interface Timeline {
  steps: TimelineStep[];
  registration: RegistrationState;
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

/** How the registration step renders for each of the three answers. */
const REGISTRATION_CHIP: Record<
  RegistrationState,
  { state: TimelineState; stateLabel: string }
> = {
  closed: { state: "completed", stateLabel: "COMPLETED" },
  open: { state: "in-progress", stateLabel: "IN PROGRESS" },
  unknown: { state: "unknown", stateLabel: "STATE UNKNOWN" },
};

const STATUS_PILL: Record<RegistrationState, string> = {
  closed: "Registration Closed",
  open: "Registration Open",
  unknown: "Registration state unknown",
};

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

  const writes = submissionsWrites(input.submissionsLock);

  // Order matters, and it is evidence first. Writes established as refused close
  // registration by themselves, including with nothing locked per school —
  // anything else would print "Registration Open" above a division in which not
  // one school can save a thing. Every school having finished closes it too, and
  // that stands on the counts alone, so it is still an answer when the switch
  // could not be read. Only with neither does the unread switch decide, and then
  // it decides `unknown`: a read that established nothing is not evidence that
  // registration is open any more than it was evidence that it was shut.
  const registration: RegistrationState =
    writes === "refused" || everySchoolFinished
      ? "closed"
      : writes === "undetermined"
        ? "unknown"
        : "open";

  // The suffix reports what is happening to *writes*, and "locked division-wide"
  // is reserved for a flag that actually reads locked. A missing settings row
  // refuses every save with nobody having locked anything, and an unreadable
  // switch is not a claim at all — printing "locked division-wide" under either
  // was this timeline swearing the division was shut beside a header that read
  // "Lock state unknown" and a dialog offering to lock it.
  const switchNote =
    input.submissionsLock.state === "locked"
      ? " · locked division-wide"
      : writes === "refused"
        ? " · division-wide saves refused: lock state unreadable"
        : writes === "undetermined"
          ? " · division-wide lock state could not be read"
          : "";

  const registrationStep: TimelineStep = {
    key: "registration",
    label: "Registration",
    ...REGISTRATION_CHIP[registration],
    // The per-school counts stay in the line whatever the switch says: they are
    // what an admin needs to see to know what turning it off would reopen.
    detail: `${count(input.schoolsLocked, "school", "schools")} locked · ${count(
      input.entries,
      "entry",
      "entries",
    )} submitted${switchNote}`,
  };

  return {
    steps: [
      registrationStep,
      ...PENDING_STEPS.map((step) => ({
        ...step,
        state: "unavailable" as const,
        stateLabel: UNAVAILABLE_LABEL,
      })),
    ],
    registration,
    statusPill: STATUS_PILL[registration],
  };
}
