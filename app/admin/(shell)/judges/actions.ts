"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import { loadJudgingEvent } from "../judging-data";
import { round1Qualifiers } from "@/lib/judging/cut";
import {
  validateJudgeInput,
  validateJudgePassword,
  type JudgeInput,
} from "@/lib/judges/judge-input";
import { createAdminClient } from "@/lib/supabase/admin";

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

/* -------------------------------------------------------------------------- *
 * The roster and the panel: migration 0029's four writes, plus 0027's two seat
 * changes.
 *
 * Same shape as the state changes above and for the same reason — every one is a
 * `security definer` RPC that re-checks the whole rule server-side, and the
 * `checkAdmin` in `withAdmin` is a courtesy rather than the boundary: it buys an
 * honest authorization sentence instead of an opaque database refusal, and stops
 * a non-admin reaching the database at all.
 *
 * The refusals these RPCs raise are written as sentences an admin can act on
 * ("this judge is seated on 2 event(s); unseat them there first"), so they are
 * passed through rather than replaced with a generic failure. That is the
 * opposite of `createSchoolAccountAction`'s handling of a unique-constraint
 * code, and deliberately so: a constraint name is not a sentence.
 * -------------------------------------------------------------------------- */

/**
 * A roster change touches every page that prints a judge's name — the index, each
 * event's panel, and the judge's own portal, which greets them by name. Revalidated
 * as a layout so the dynamic children go with it: there is no list of event ids to
 * enumerate here, and a stale name on one panel is exactly the drift this avoids.
 */
function revalidateRoster() {
  revalidatePath("/admin/judges", "layout");
  revalidatePath("/admin/tabulators", "layout");
  revalidatePath("/judge", "layout");
}

/**
 * Add a judge to the roster.
 *
 * No login is made here. 0018's order of business is that a panel is agreed in a
 * meeting and the accounts follow, so a judge on file with no login is the normal
 * intermediate state rather than a half-finished write to be repaired — which is
 * why this does not mirror `createSchoolAccountAction`'s create-then-provision
 * pair and needs none of its rollback.
 */
export async function createJudgeAction(input: JudgeInput): Promise<ActionResult> {
  const validated = validateJudgeInput(input);
  if ("error" in validated) return validated;
  const { judge } = validated;

  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_create_judge", {
      p_first_name: judge.firstName,
      p_middle_name: judge.middleName,
      p_last_name: judge.lastName,
      p_email: judge.email,
      p_affiliation: judge.affiliation,
    });
    if (error) return { error: `That judge was not added: ${error.message}` };
    revalidateRoster();
  });
}

/**
 * Correct a judge's details.
 *
 * The email of a judge who already has a login is refused by the RPC, because
 * `judges.email` is what the console shows and `auth.users.email` is what they type
 * to sign in, and this write can only move one of the two.
 */
export async function updateJudgeAction(
  judgeId: string,
  input: JudgeInput
): Promise<ActionResult> {
  const validated = validateJudgeInput(input);
  if ("error" in validated) return validated;
  const { judge } = validated;

  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_update_judge", {
      p_judge_id: judgeId,
      p_first_name: judge.firstName,
      p_middle_name: judge.middleName,
      p_last_name: judge.lastName,
      p_email: judge.email,
      p_affiliation: judge.affiliation,
    });
    if (error) return { error: `That judge was not changed: ${error.message}` };
    revalidateRoster();
  });
}

/**
 * Take a judge off the roster, or put them back on.
 *
 * A soft flag rather than a delete, because a withdrawn judge's submitted sheets
 * still feed placements (0018). Deactivating someone still holding a seat is
 * refused by the RPC: `admin_lock_results` wants three active judges in seats 2 to
 * 4, so clearing the flag would quietly make that event unpublishable with nothing
 * on its own page to say why.
 */
export async function setJudgeActiveAction(
  judgeId: string,
  active: boolean
): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_set_judge_active", {
      p_judge_id: judgeId,
      p_active: active,
    });
    if (error) {
      return {
        error: `That judge was not ${active ? "reactivated" : "deactivated"}: ${error.message}`,
      };
    }
    revalidateRoster();
  });
}

/**
 * Make the login a judge signs in with at `/judge/login`.
 *
 * Two clients, on purpose. Creating an `auth.users` row is the one thing SQL
 * cannot do, so that half goes through `createAdminClient()` — a service-role
 * client that bypasses row level security entirely. Attaching the result goes back
 * through the admin's *own* session, because `admin_link_judge_login` checks
 * `auth.uid()` against `admin_profiles` and the service role has no `auth.uid()`.
 * So the judges table is still only ever written by 0029's functions, and the
 * service role is never reached without `checkAdmin` refusing first.
 *
 * The address is the judge's own, not a synthesised one: unlike a school, whose
 * address `resolveSchoolEmail` derives from its DepEd id, a judge carries no
 * identifier the division owns. That is also why a judge with no email on file
 * cannot be provisioned — there is nothing to make the account under.
 */
export async function provisionJudgeLoginAction(
  judgeId: string,
  password: string
): Promise<ActionResult> {
  const checked = validateJudgePassword(password);
  if ("error" in checked) return checked;

  return withAdmin(async (supabase) => {
    const service = createAdminClient();

    const { data: judge, error: lookupError } = await service
      .from("judges")
      .select("id, email, auth_user_id")
      .eq("id", judgeId)
      .single();

    if (lookupError || !judge) {
      console.error("provisionJudgeLoginAction lookup", lookupError);
      return { error: "That judge could not be found." };
    }
    // Re-read rather than trusted from whatever roster the caller was looking at:
    // another admin may have provisioned this same judge since the page loaded, and
    // a second auth user would orphan the first login's credentials.
    if (judge.auth_user_id) return { error: "This judge already has a login." };
    if (!judge.email) {
      return {
        error:
          "This judge has no email address on file, and the address is what they sign in with. Add one first.",
      };
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: judge.email,
      password: checked.password,
      // No mail leaves this system, so an unconfirmed account would simply be one
      // nobody can ever sign in to. The school seeder and its live counterpart both
      // confirm on creation for the same reason.
      email_confirm: true,
    });

    if (createError || !created.user) {
      console.error("provisionJudgeLoginAction createUser", createError);
      return { error: "Could not create a login for that judge." };
    }

    const { error: linkError } = await supabase.rpc("admin_link_judge_login", {
      p_judge_id: judgeId,
      p_auth_user_id: created.user.id,
    });

    if (linkError) {
      console.error("provisionJudgeLoginAction link", linkError);
      // Undo the account above. The address comes from the judge row, so leaving it
      // behind would make every retry — including the one this sentence sends the
      // admin back for — fail forever on Supabase Auth's unique-email constraint.
      const { error: rollbackError } = await service.auth.admin.deleteUser(created.user.id);
      if (rollbackError) {
        console.error("provisionJudgeLoginAction rollback failed; orphaned auth user", {
          authUserId: created.user.id,
          email: created.user.email,
          rollbackError,
        });
      }
      return { error: `The login was made but could not be attached: ${linkError.message}` };
    }

    revalidateRoster();
  });
}

/**
 * Seat a judge (N1: seat 1 ranks round 1; seats 2, 3 and 4 rank round 2).
 *
 * Reseating an occupied seat replaces rather than failing — that is how an admin
 * corrects a panel — and the displaced judge's sheets survive, because
 * `judge_sheets` keys on the judge rather than on the assignment. The same judge
 * cannot hold two seats on one event: 0018's unique `(judge_id, event_id)` is what
 * stops the judge who made the cut also placing the winners.
 */
export async function assignJudgeAction(
  eventId: string,
  judgeId: string,
  seat: number
): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_assign_judge", {
      p_event_id: eventId,
      p_judge_id: judgeId,
      p_seat: seat,
    });
    if (error) return { error: `Seat ${seat} was not filled: ${error.message}` };
    revalidate(eventId);
    // The seat changes who this judge sees events for, and the roster's Events
    // column counts the seats they hold, so both indexes move with it.
    revalidateRoster();
  });
}

/**
 * Empty a seat.
 *
 * Refused while that seat's judge has a submitted sheet: an empty seat whose ranks
 * are still on file is the one state that could feed a placement from somebody no
 * longer on the panel. The admin unlocks the sheet first — see
 * {@link unlockJudgeSheetAction} — rather than having this discard ranks on the way
 * past.
 */
export async function unassignJudgeAction(eventId: string, seat: number): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_unassign_judge", {
      p_event_id: eventId,
      p_seat: seat,
    });
    if (error) return { error: `Seat ${seat} was not emptied: ${error.message}` };
    revalidate(eventId);
    revalidateRoster();
  });
}

/**
 * Give one judge their sheet back.
 *
 * A judge cannot un-submit — submitting is locking (N6) — so this is the only way
 * one gets a second chance, and it is also the only way out of a seat that refuses
 * to be emptied. Narrow on purpose: the RPC clears the submission and nothing else,
 * so the judge reopens the board they already typed rather than an empty one.
 *
 * Refused inside a locked round, which is the rule worth knowing here. Reopening a
 * sheet under a qualifier list or a published standing would let a rank move
 * beneath either without the round itself being reopened, so the round comes first
 * and the sentence the RPC raises says which one.
 */
export async function unlockJudgeSheetAction(
  eventId: string,
  judgeId: string,
  round: number
): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { error } = await supabase.rpc("admin_unlock_judge_sheet", {
      p_event_id: eventId,
      p_judge_id: judgeId,
      p_round: round,
    });
    if (error) return { error: `That sheet was not reopened: ${error.message}` };
    revalidate(eventId);
  });
}
