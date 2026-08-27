"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import { loadJudgingEvent } from "../judging-data";
import { round1Qualifiers } from "@/lib/judging/cut";

/**
 * The four state changes on an event's panel page, and the two unlocks that
 * reverse them.
 *
 * Every one is a `security definer` RPC that re-checks the whole rule server-side
 * (non-negotiable 2): the caller is an admin, the event is individual, the round
 * is in the right state, and — for the two locks — that the judges who had to
 * submit have. Nothing here is the authorisation boundary. What these functions
 * add is the *payload*, and that is the interesting part.
 *
 * ## Why the qualifier list and the standings are computed here
 *
 * `admin_lock_round1` takes the qualifier list as an argument rather than
 * deriving it, and `admin_lock_results` takes the standings the same way. That is
 * non-negotiable 3: the cut rule and the final-rank rule exist once, in
 * `lib/judging`, with tests — not in SQL and not in a page. The RPCs check the
 * list they are given is *defensible* (every qualifier was in fact scored by seat
 * 1; no unit appears twice) without re-deriving it, so a forged payload is caught
 * and the rule still lives in one place.
 */

type ActionResult = { error: string } | void;

/** The shape `admin_lock_round1` reads out of its jsonb argument. */
interface QualifierPayload {
  participantId: string;
  round1Rank: number;
  round1Points: number;
}

async function withAdmin(
  run: (supabase: Awaited<ReturnType<typeof checkAdmin>>["supabase"]) => Promise<ActionResult>
): Promise<ActionResult> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return { error: "You are not signed in as an administrator. Sign in again and retry." };
  }
  return run(check.supabase);
}

function revalidate(eventId: string) {
  revalidatePath("/admin/judges");
  revalidatePath(`/admin/judges/${eventId}`);
  revalidatePath("/admin/tabulators");
  revalidatePath(`/admin/tabulators/${eventId}`);
  // The judge portal reads the same lock: locking round 1 is what opens round 2
  // for seats 2 to 4, and unlocking it is what reopens seat 1's sheet.
  revalidatePath("/judge");
  revalidatePath(`/judge/${eventId}`);
}

/**
 * The per-event round 2 cut.
 *
 * There is no division-wide cut and no default written here. `events.round2_cut`
 * is per event and this is how it is chosen; the column's `default 10` is only
 * the value an untouched event starts on, never a decision anyone took. The RPC
 * refuses the change once round 1 is locked, because a cut that has already
 * produced a qualifier list cannot move under it.
 */
export async function setRound2CutAction(eventId: string, cut: number): Promise<ActionResult> {
  if (!Number.isInteger(cut) || cut < 1) {
    return { error: "The cut must be a whole number of at least 1." };
  }

  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_set_round2_cut", {
      p_event_id: eventId,
      p_cut: cut,
    });
    if (error) return { error: `The cut was not changed: ${error.message}` };
    revalidate(eventId);
  });
}

/**
 * Lock round 1, which is the act that draws the qualifiers (N6).
 *
 * The list is drawn from `round1Cut` — round 1 as one judge's typed ranks — and
 * never from the consolidated panel board beside it. That board reads a blank as
 * a missing opinion rather than an elimination, so under a cut it is permanently
 * incomplete and every rank on it is null: drawing from it would lock the round
 * with an empty qualifier list and no error to show for it.
 */
export async function lockRound1Action(eventId: string): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { row, error } = await loadJudgingEvent(eventId);
    if (error) return { error: `${error} Round 1 was not locked.` };
    if (!row) return { error: "This event could not be found." };

    if (row.round1Cut === null) {
      return {
        error:
          "This is a group event. The two-stage rounds cover individual events only.",
      };
    }

    const cut = row.round2Cut;
    if (cut === null) {
      return {
        error: "This event has no round 2 cut on file, so there is no field to draw.",
      };
    }

    const qualifiers = round1Qualifiers(row.round1Cut, cut);
    if (qualifiers.length === 0) {
      return {
        error:
          "No contestant was ranked in round 1, so locking it would draw an empty field. Check the judge's sheet first.",
      };
    }

    const payload: QualifierPayload[] = qualifiers.map((qualifier) => ({
      // The RPC keys the insert on this, and an individual event's unit key is
      // the participant id. A null would be a group unit, which the guard above
      // has already ruled out.
      participantId: qualifier.participantId ?? qualifier.unitKey,
      round1Rank: qualifier.round1Rank,
      round1Points: qualifier.round1Points,
    }));

    const { error: rpcError } = await supabase.rpc("admin_lock_round1", {
      p_event_id: eventId,
      p_qualifiers: payload,
    });
    if (rpcError) return { error: `Round 1 was not locked: ${rpcError.message}` };
    revalidate(eventId);
  });
}

/**
 * Reopen round 1 (N7), which also reopens round 2 (N8).
 *
 * The consequence is the RPC's, not this function's: editing round 1 can change
 * who qualifies, so every round 2 submission is cleared and the qualifier list is
 * discarded. Refused while the results are locked, so no unlock can silently
 * contradict a published standing.
 */
export async function unlockRound1Action(eventId: string): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_unlock_round1", { p_event_id: eventId });
    if (error) return { error: `Round 1 was not reopened: ${error.message}` };
    revalidate(eventId);
  });
}

/**
 * Publish the results.
 *
 * The standings are the row's own array — the same one the index's Placed column
 * counts and the tabulators' sheet renders — so what is frozen into
 * `event_rounds.standings` is exactly what the admin was looking at when they
 * pressed the button.
 */
export async function lockResultsAction(eventId: string): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { row, error } = await loadJudgingEvent(eventId);
    if (error) return { error: `${error} The results were not locked.` };
    if (!row) return { error: "This event could not be found." };

    if (row.standings === null) {
      return {
        error: "This event has no round 2 cut on file, so it has no standings to publish.",
      };
    }
    if (row.standings.every((standing) => standing.finalRank === null)) {
      return {
        error:
          "No contestant has an official placement yet. Round 2 must be complete before the results can be published.",
      };
    }

    const { error: rpcError } = await supabase.rpc("admin_lock_results", {
      p_event_id: eventId,
      p_standings: row.standings,
    });
    if (rpcError) return { error: `The results were not locked: ${rpcError.message}` };
    revalidate(eventId);
  });
}

/** Unlock the results, clearing the freeze as well as the stamp. */
export async function unlockResultsAction(eventId: string): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_unlock_results", { p_event_id: eventId });
    if (error) return { error: `The results were not unlocked: ${error.message}` };
    revalidate(eventId);
  });
}
