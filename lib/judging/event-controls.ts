import type { EventJudgingStatus } from "./types";

/**
 * Which of an event's six state changes an admin may make right now, and the
 * sentence to show when they may not.
 *
 * Nothing here is enforcement. Every one of these is a `security definer` RPC
 * that re-checks the whole rule inside the database (non-negotiable 2), so what
 * this module decides is only what the console *offers* — a control it enables
 * wrongly is refused by the RPC, and a control it disables wrongly has still not
 * let anything through. It exists so the page and its tests agree about the
 * offer, following `lib/submissions/lock-state.ts`: nothing in this repo renders
 * a component under test, so the decision has to live where a test can reach it.
 *
 * The disabled sentences say what is missing rather than "not available", because
 * an admin standing at a panel with a judge waiting needs to know which of the
 * two they are: a round that nobody has submitted, or one they have already
 * closed.
 */

export type EventControlId =
  | "set-cut"
  | "lock-round1"
  | "unlock-round1"
  | "lock-results"
  | "unlock-results";

export interface EventControl {
  id: EventControlId;
  /** Null when the control may be pressed; otherwise the reason it may not. */
  disabledReason: string | null;
}

/** What the six controls are decided from. */
export interface EventControlFacts {
  status: EventJudgingStatus;
  /** `events.round2_cut`. Null means no cut is on file, which is not the same as a cut of 0. */
  round2Cut: number | null;
  /**
   * Whether this event has a single-judge round 1 — `round1Cut !== null` on the
   * index row. A group event has none, and the two-stage rounds do not touch its
   * model at all (non-negotiable 6), so every control is refused for one rather
   * than rendered as though a lock were merely out of reach.
   */
  individual: boolean;
}

const GROUP_EVENT = "This is a group event. The two-stage rounds cover individual events only.";

/** Statuses in which round 1 has been locked and its qualifier list drawn. */
const AFTER_ROUND1_LOCK: readonly EventJudgingStatus[] = [
  "round2-open",
  "round2-awaiting-lock",
  "locked",
];

function setCutReason(facts: EventControlFacts): string | null {
  // The line is the ranks, not the lock (migration 0030). The cut decides how
  // tall round 1's dropdown is, so the moment it starts to matter is the moment
  // somebody ranks against it — not the later moment an admin closes the round.
  //
  // Locking used to be the test, which let the cut drop from 10 to 5 underneath a
  // sheet that had already ranked ten: those ranks then sit above the cut the
  // sheet is read under, a state `judging_write_sheet` will not write and
  // that only this control could ever have produced.
  if (AFTER_ROUND1_LOCK.includes(facts.status)) {
    return "Round 1 is closed and its field is drawn. Reopen round 1, then reopen seat 1's sheet, and the cut can change.";
  }
  if (facts.status === "round1-awaiting-close") {
    return "Round 1's judge has ranked against this cut. Reopen their sheet to change it.";
  }
  return null;
}

function lockRound1Reason(facts: EventControlFacts): string | null {
  if (AFTER_ROUND1_LOCK.includes(facts.status)) return "Round 1 is already closed.";
  if (facts.status !== "round1-awaiting-close") {
    return "Round 1's judge has not submitted a sheet yet, so there is nothing to draw a field from.";
  }
  // Checked after the status so an event mid-round is told the judge is
  // outstanding, which is the thing anyone can act on, rather than being sent to
  // set a cut it still has time to set.
  if (facts.round2Cut === null) {
    return "This event has no round 2 cut on file, so there is no field to draw.";
  }
  return null;
}

function unlockRound1Reason(facts: EventControlFacts): string | null {
  // Refused while the results stand, so no unlock can silently contradict a
  // published standing: unlocking round 1 clears every round 2 submission.
  if (facts.status === "locked") {
    return "The results are published. Unlock the results first — reopening round 1 clears round 2.";
  }
  if (!AFTER_ROUND1_LOCK.includes(facts.status)) return "Round 1 is not closed yet.";
  return null;
}

function lockResultsReason(facts: EventControlFacts): string | null {
  if (facts.status === "locked") return "The results are already published.";
  if (facts.status !== "round2-awaiting-lock") {
    return "Round 2 is not complete yet. Every seated judge must submit before the results can be published.";
  }
  return null;
}

function unlockResultsReason(facts: EventControlFacts): string | null {
  if (facts.status !== "locked") return "The results are not published.";
  return null;
}

/**
 * The six controls, in the order the panel page renders them.
 *
 * Always all six, never a filtered list: a control that disappears in some states
 * teaches an admin that the console's shape is a guess, and the sentence on a
 * disabled one is the only place the state machine explains itself.
 */
export function eventControls(facts: EventControlFacts): EventControl[] {
  const reason = facts.individual
    ? {
        "set-cut": setCutReason(facts),
        "lock-round1": lockRound1Reason(facts),
        "unlock-round1": unlockRound1Reason(facts),
        "lock-results": lockResultsReason(facts),
        "unlock-results": unlockResultsReason(facts),
      }
    : {
        "set-cut": GROUP_EVENT,
        "lock-round1": GROUP_EVENT,
        "unlock-round1": GROUP_EVENT,
        "lock-results": GROUP_EVENT,
        "unlock-results": GROUP_EVENT,
      };

  return (
    ["set-cut", "lock-round1", "unlock-round1", "lock-results", "unlock-results"] as const
  ).map((id) => ({ id, disabledReason: reason[id] }));
}

/** One control by id, for a page that renders them individually. */
export function eventControl(facts: EventControlFacts, id: EventControlId): EventControl {
  const found = eventControls(facts).find((control) => control.id === id);
  // Unreachable: `id` is the closed union `eventControls` maps over.
  if (!found) throw new Error(`Unknown event control: ${id}`);
  return found;
}
