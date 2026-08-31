import { eventControl, type EventControlId } from "./event-controls";
import type { EventIndexRow } from "./event-index";

/**
 * Closing rounds across the whole catalog in one action.
 *
 * The panel page locks one event at a time, which is right when an admin is
 * standing at one panel. It is the wrong shape for the end of a contest day, when
 * forty individual events have all finished and each needs the same two clicks —
 * and where the cost of missing one is a round that stays open with nothing on
 * screen to say it was overlooked.
 *
 * ## What this does not decide
 *
 * Nothing here locks anything, and nothing here is enforcement. Eligibility is
 * read from `eventControl`, the same function the per-event buttons are enabled
 * from, so a bulk run offers exactly what the individual controls offer; the RPCs
 * re-check every rule again (non-negotiable 2). What this module adds is the
 * *plan*: which events a scope would touch, and — the half that matters — which it
 * would skip and why, so an admin sees the whole answer before pressing anything
 * rather than a toast afterwards saying thirty-one of forty worked.
 *
 * ## Why there is no group scope
 *
 * There is no such thing as locking a group event's round. The two-stage rounds
 * cover individual events only (non-negotiable 6): `admin_lock_round1` and
 * `admin_lock_results` both refuse a group event outright, and `eventControls`
 * gives every one of its five controls the same sentence. A group event is judged
 * on one consolidated panel board and has no round to close.
 *
 * The two group scopes are therefore *offered and refused* rather than left out —
 * see {@link BULK_LOCK_SCOPES}. Leaving them off the list would answer the
 * question by pretending it was never asked; naming them and saying why is the
 * same choice `eventControls` makes when it renders all five controls for a group
 * event and disables them all.
 */

export type BulkLockScopeId =
  | "round1-individual"
  | "results-individual"
  | "both-individual"
  | "round1-group"
  | "results-group";

export interface BulkLockScope {
  id: BulkLockScopeId;
  label: string;
  /** What it does, or — for a group scope — why it cannot. */
  detail: string;
  /**
   * The controls a run performs, in order. Empty for a scope that cannot run,
   * which is what {@link bulkLockPlan} reads to refuse it.
   */
  controls: readonly EventControlId[];
}

/**
 * The five choices, in the order the dialog lists them.
 *
 * "Round 2" is `lock-results` and not a lock of its own: round 2 ends by publishing
 * the standings, and there is no separate close between the last judge submitting
 * and the results being frozen. The label says round 2 because that is the round an
 * admin is finishing; the detail says what it actually writes.
 */
export const BULK_LOCK_SCOPES: readonly BulkLockScope[] = [
  {
    id: "round1-individual",
    label: "Round 1 — individual events",
    detail:
      "Closes round 1 and draws each event's qualifier list from the seat 1 judge's sheet.",
    controls: ["lock-round1"],
  },
  {
    id: "results-individual",
    label: "Round 2 — individual events",
    detail:
      "Publishes the standings, which is how round 2 ends. Only events whose whole panel has submitted.",
    controls: ["lock-results"],
  },
  {
    id: "both-individual",
    label: "Everything ready — individual events",
    detail:
      "Closes round 1 where it can, and publishes results where round 2 is complete. An event is only ever taken one step: closing round 1 does not publish the results of a round 2 that has not been judged yet.",
    controls: ["lock-round1", "lock-results"],
  },
  {
    id: "round1-group",
    label: "Round 1 — group events",
    detail:
      "Not available. The two-stage rounds cover individual events only, so a group event has no round 1 to close — it is judged on one consolidated panel board.",
    controls: [],
  },
  {
    id: "results-group",
    label: "Round 2 — group events",
    detail:
      "Not available, for the same reason: a group event has no second round. Nothing in the catalog locks a group event today.",
    controls: [],
  },
];

export function bulkLockScope(id: string): BulkLockScope | null {
  return BULK_LOCK_SCOPES.find((scope) => scope.id === id) ?? null;
}

/** One event a run would act on. */
export interface BulkLockStep {
  eventId: string;
  eventName: string;
  control: EventControlId;
}

/** One event a run would leave alone, and the reason it gives. */
export interface BulkLockSkip {
  eventId: string;
  eventName: string;
  reason: string;
}

export interface BulkLockPlan {
  steps: BulkLockStep[];
  skipped: BulkLockSkip[];
  /** Set when the scope itself cannot run at all, whatever the catalog holds. */
  unavailable: string | null;
}

/**
 * What a scope would do to this catalog, right now.
 *
 * An event contributes **at most one step**, even under a scope carrying two
 * controls. Closing round 1 changes what the event is: the qualifier list is
 * drawn, round 2 opens, and nobody has ranked it yet — so a plan that also queued
 * `lock-results` would be queueing a publication of standings that do not exist,
 * and the RPC would refuse it a second later. One step per event per run, and the
 * admin runs it again when the panel has finished.
 *
 * A skipped event always carries the control's own sentence rather than a summary
 * of its own. "Round 1's judge has not submitted a sheet yet" is the thing an admin
 * can act on; "not eligible" is not.
 */
export function bulkLockPlan(rows: EventIndexRow[], scope: BulkLockScope): BulkLockPlan {
  if (scope.controls.length === 0) {
    return { steps: [], skipped: [], unavailable: scope.detail };
  }

  const steps: BulkLockStep[] = [];
  const skipped: BulkLockSkip[] = [];

  for (const row of rows) {
    const facts = {
      status: row.state.status,
      round2Cut: row.round2Cut,
      // `round1Cut` is null for exactly the group events (non-negotiable 6), which
      // is the same test the panel page makes.
      individual: row.round1Cut !== null,
    };

    let queued = false;
    let firstReason: string | null = null;

    for (const control of scope.controls) {
      const { disabledReason } = eventControl(facts, control);
      if (disabledReason === null) {
        steps.push({ eventId: row.eventId, eventName: eventLabel(row), control });
        queued = true;
        break;
      }
      firstReason ??= disabledReason;
    }

    if (!queued) {
      skipped.push({
        eventId: row.eventId,
        eventName: eventLabel(row),
        reason: firstReason ?? "This event is not ready.",
      });
    }
  }

  return { steps, skipped, unavailable: null };
}

/** "News Writing · Elem · Eng" — the event named the way every judging table names it. */
function eventLabel(row: EventIndexRow): string {
  return `${row.typeNameEn} · ${row.slotLabel}`;
}

/**
 * What a finished run says.
 *
 * Locked and failed are counted separately from skipped on purpose. A skip was
 * decided before anything was attempted and is the ordinary case — most of the
 * catalog is not ready most of the time. A failure is an event this plan believed
 * was ready and the database refused, which is a different thing entirely and the
 * only one worth chasing.
 */
export function bulkLockSummary(input: {
  locked: number;
  failed: number;
  skipped: number;
}): string {
  const { locked, failed, skipped } = input;
  const parts: string[] = [
    `${locked} ${locked === 1 ? "event" : "events"} locked`,
  ];
  if (failed > 0) parts.push(`${failed} refused`);
  if (skipped > 0) parts.push(`${skipped} not ready`);
  return parts.join(", ") + ".";
}
