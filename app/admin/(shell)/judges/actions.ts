"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import { loadJudgingEvent, loadJudgingEventIndex, loadSheetEntry } from "../judging-data";
import { bulkCutPlan, bulkCutSummary } from "@/lib/judging/bulk-cut";
import {
  bulkLockPlan,
  bulkLockScope,
  bulkLockSummary,
} from "@/lib/judging/bulk-lock";
import { MAX_ROUND2_CUT, round1Qualifiers } from "@/lib/judging/cut";
import {
  toRankPayload,
  validateSheetDraft,
  type RankDraft,
} from "@/lib/judging/sheet-form";
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
 * is per event and this is how it is chosen; the column's `default 30` is only
 * the value an untouched event starts on, never a decision anyone took. The RPC
 * refuses the change once round 1 is locked, because a cut that has already
 * produced a qualifier list cannot move under it.
 *
 * The ceiling is `MAX_ROUND2_CUT`, checked here for the sentence and again in the
 * RPC, which is the boundary. A cut above what round 1 can record would admit
 * ranks seat 1 has no way to type.
 */
export async function setRound2CutAction(eventId: string, cut: number): Promise<ActionResult> {
  if (!Number.isInteger(cut) || cut < 1) {
    return { error: "The cut must be a whole number of at least 1." };
  }
  if (cut > MAX_ROUND2_CUT) {
    return {
      error: `The cut cannot be more than ${MAX_ROUND2_CUT}, which is as far down the field as round 1 can rank.`,
    };
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

/**
 * Type a judge's sheet in for them, from paper (N9).
 *
 * The division judges on paper at the venue and encodes afterwards, so this is not
 * a repair path — it is the ordinary way most sheets arrive. It writes the same
 * sheet the judge's own screen writes: `admin_enter_sheet` and `judge_submit_sheet`
 * both call `judging_write_sheet`, which validates identically. The only difference
 * is whose id lands in `entered_by`, and that column exists for exactly this.
 *
 * ## Why the sheet is re-read instead of trusted
 *
 * The payload arrives from a client, so the seat, the round, the unit set, the cut
 * and whether this sheet may be written at all are re-derived here from the database
 * rather than read out of the form. A form left open while another admin closed
 * round 1, moved the cut or reopened a sheet would otherwise submit against numbers
 * that stopped being true while it sat there.
 *
 * Still not the authorisation boundary. `judging_write_sheet` re-checks every rule
 * server-side (non-negotiable 2). What this adds is a sentence naming the row that
 * is wrong, which the RPC cannot give, and the entry rules' own sentence for a sheet
 * that was never writable.
 */
export async function enterJudgeSheetAction(
  eventId: string,
  judgeId: string,
  draft: RankDraft
): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    const { entry, error } = await loadSheetEntry(eventId, judgeId);
    if (error) return { error: `${error} The sheet was not saved.` };
    if (!entry) return { error: "That judge does not hold a seat on this event." };
    if (!entry.entry.canEnter) return { error: entry.entry.reason };

    const invalid = validateSheetDraft(entry.spec, entry.units, draft);
    if (invalid) return { error: invalid };

    const { error: rpcError } = await supabase.rpc("admin_enter_sheet", {
      p_event_id: eventId,
      p_round: entry.round,
      p_judge_id: judgeId,
      p_ranks: toRankPayload(draft),
    });
    if (rpcError) return { error: `The sheet was not saved: ${rpcError.message}` };

    revalidate(eventId);
  });
}

/**
 * Remove a judge from the roster outright (migration 0030).
 *
 * The counterpart to {@link setJudgeActiveAction}, and not a replacement for it.
 * Deactivating is for a judge who judged and has retired: their submitted ranks
 * still feed placements, so the row has to stay. Deleting is for a row that was
 * never anybody — a typo, a duplicate, somebody who agreed in June and withdrew in
 * July — and leaving those as "inactive" makes a roster an admin cannot read,
 * because a retired judge and a mistake then look identical.
 *
 * The line is the ranks. A judge with no submitted sheet has contributed nothing any
 * placement rests on, and their seats, drafts and the ranks on those drafts go with
 * them through 0018's cascade — which is also how a panel gets somebody replaced
 * before judging starts. One with a submitted sheet is refused by the RPC, in a
 * sentence naming how many.
 *
 * ## The login is deleted second, and may outlive the judge
 *
 * `auth.users` is not writable from SQL, so the RPC hands back the id and this
 * deletes it with the service role — the same split provisioning uses, in reverse.
 * The order matters: the judge row goes first, because that is the delete carrying
 * the rule, and a login left behind resolves to no judge and is refused at
 * `/judge/login` by the guard. What it *does* still hold is the email address, and
 * Auth will not issue a second account for one — so a failure there is reported
 * rather than swallowed, since the next thing an admin does is usually re-add the
 * same person.
 */
export async function deleteJudgeAction(judgeId: string): Promise<ActionResult> {
  return withAdmin(async (supabase) => {
    // Through the admin's own session, not the service role: the RPC checks
    // `auth.uid()` against `admin_profiles`, and the service role has no uid.
    const { data: authUserId, error } = await supabase.rpc("admin_delete_judge", {
      p_judge_id: judgeId,
    });
    if (error) return { error: `That judge was not deleted: ${error.message}` };

    revalidateRoster();

    if (typeof authUserId !== "string") return;

    const { error: loginError } = await createAdminClient().auth.admin.deleteUser(authUserId);
    if (loginError) {
      console.error("deleteJudgeAction: judge deleted, login orphaned", {
        judgeId,
        authUserId,
        loginError,
      });
      return {
        error:
          "The judge was deleted, but their login could not be removed. It can no longer sign in, but it still holds their email address — adding that same address again will not be able to get a login until it is cleared in Supabase Auth.",
      };
    }
  });
}

export interface BulkLockPreview {
  scopeId: string;
  steps: { eventId: string; eventName: string; control: string }[];
  skipped: { eventId: string; eventName: string; reason: string }[];
  /** Set when the scope cannot run at all — the two group scopes. */
  unavailable: string | null;
}

/**
 * What a bulk run would do, without doing any of it.
 *
 * Read before the dialog offers the button, because the whole point of a bulk
 * action is that the admin cannot see the forty events it covers. A toast
 * afterwards saying "31 of 40 locked" is a report on work already done; this is
 * the same information in the one place it can still change the decision.
 */
export async function previewBulkLockAction(
  scopeId: string
): Promise<{ error: string } | { preview: BulkLockPreview }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to close a round.",
    };
  }

  const scope = bulkLockScope(scopeId);
  if (!scope) return { error: "That is not a lock this console offers." };

  const { rows, error } = await loadJudgingEventIndex();
  // A failed catalog read must not become an empty plan. "Nothing to lock" and "the
  // catalog could not be read" are different answers, and only one of them means an
  // admin can go home (non-negotiable 5).
  if (error) return { error: `The event catalog could not be read: ${error}` };

  const plan = bulkLockPlan(rows, scope);
  return { preview: { scopeId: scope.id, ...plan } };
}

/**
 * Run a bulk lock.
 *
 * The plan is drawn again here rather than taken from the client. A preview is a
 * screen an admin may have been looking at for ten minutes while a judge submitted
 * one more sheet, and a payload of event ids would lock whatever was ready *then* —
 * including, in the worst case, an event a colleague has since reopened. The list
 * is derived from the catalog as it is at the moment of the click, and each step
 * still goes through the same per-event action the panel page uses, so every rule
 * is checked by the RPC exactly as it is for a single lock.
 *
 * Sequential, not `Promise.all`. Each of these is several statements against the
 * same few tables and one of them rewrites a qualifier list; running forty at once
 * to save a few seconds would trade a wholly predictable order for lock contention
 * on the rows the next step reads.
 */
export async function runBulkLockAction(scopeId: string): Promise<
  | { error: string }
  | {
      success: true;
      locked: { eventName: string }[];
      failed: { eventName: string; reason: string }[];
      skipped: number;
      summary: string;
    }
> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to close a round.",
    };
  }

  const scope = bulkLockScope(scopeId);
  if (!scope) return { error: "That is not a lock this console offers." };
  if (scope.controls.length === 0) return { error: scope.detail };

  const { rows, error } = await loadJudgingEventIndex();
  if (error) return { error: `The event catalog could not be read: ${error}` };

  const plan = bulkLockPlan(rows, scope);

  const locked: { eventName: string }[] = [];
  const failed: { eventName: string; reason: string }[] = [];

  for (const step of plan.steps) {
    const result =
      step.control === "lock-round1"
        ? await lockRound1Action(step.eventId)
        : await lockResultsAction(step.eventId);

    // A refusal stops that event and nothing else. Forty events are forty separate
    // contests, and one that cannot be closed is no reason to leave the other
    // thirty-nine open — which is exactly what a throw here would do.
    if (result && "error" in result) {
      failed.push({ eventName: step.eventName, reason: result.error });
      continue;
    }
    locked.push({ eventName: step.eventName });
  }

  return {
    success: true as const,
    locked,
    failed,
    skipped: plan.skipped.length,
    summary: bulkLockSummary({
      locked: locked.length,
      failed: failed.length,
      skipped: plan.skipped.length,
    }),
  };
}

export interface BulkCutPreview {
  steps: {
    eventId: string;
    eventName: string;
    from: number | null;
    to: number;
    qualifiers: number;
    wasLocked: boolean;
  }[];
  skipped: { eventId: string; eventName: string; reason: string }[];
  unchanged: number;
}

/**
 * Which events have a cut standing below the number their judge ranked.
 *
 * Read before anything is offered, because every event this touches is one whose
 * round has to be reopened and closed again, and an admin cannot see forty events
 * to know which those are.
 */
export async function previewBulkCutAction(): Promise<
  { error: string } | { preview: BulkCutPreview }
> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to change an event's cut.",
    };
  }

  const { rows, error } = await loadJudgingEventIndex();
  if (error) return { error: `The event catalog could not be read: ${error}` };

  const plan = bulkCutPlan(rows);
  return {
    preview: {
      // The judge id is dropped rather than sent: the client never needs it, and the
      // run re-derives the whole plan for itself anyway.
      steps: plan.steps.map((step) => ({
        eventId: step.eventId,
        eventName: step.eventName,
        from: step.from,
        to: step.to,
        qualifiers: step.qualifiers,
        wasLocked: step.wasLocked,
      })),
      skipped: plan.skipped,
      unchanged: plan.unchanged,
    },
  };
}

/**
 * Raise each event's cut to the number its judge ranked, so nobody placed in round
 * 1 is left out of round 2.
 *
 * ## The five steps, and why they are all necessary
 *
 * The cut cannot simply be updated. On a closed round the qualifier list has
 * already been drawn from it, and `admin_set_round2_cut` refuses while seat 1's
 * sheet stands submitted (migration 0030). So each event goes:
 *
 *   1. reopen round 1, where it was closed — this discards the qualifier list
 *   2. reopen seat 1's round 1 sheet, which keeps every rank and clears only the
 *      submission
 *   3. set the cut to the number ranked
 *   4. re-submit that same sheet, unchanged, which `loadSheetEntry` hands back
 *      as the draft it saved
 *   5. close round 1 again, where it was closed — redrawing the list under the
 *      new cut
 *
 * Nothing is retyped and no rank moves. The sheet that comes back out is the sheet
 * that went in; what changes is the number the list is drawn against.
 *
 * ## Where it stops
 *
 * A step that fails abandons that event and moves to the next, and the event is
 * reported by name. Two of the five steps leave an event mid-sequence if they fail
 * — a round reopened but not closed again, most likely — and that is a state the
 * panel page shows plainly and an admin can finish by hand. The alternative, a
 * blanket rollback, would mean re-locking a round this function had just failed to
 * lock, which is not a recovery.
 *
 * The plan is drawn here rather than taken from the client, for the reason
 * `runBulkLockAction` gives: a preview may have been on screen while a judge
 * submitted one more sheet.
 */
export async function runBulkCutAction(): Promise<
  | { error: string }
  | {
      success: true;
      changed: { eventName: string; from: number | null; to: number }[];
      failed: { eventName: string; reason: string }[];
      unchanged: number;
      summary: string;
    }
> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to change an event's cut.",
    };
  }

  const { rows, error } = await loadJudgingEventIndex();
  if (error) return { error: `The event catalog could not be read: ${error}` };

  const plan = bulkCutPlan(rows);
  const changed: { eventName: string; from: number | null; to: number }[] = [];
  const failed: { eventName: string; reason: string }[] = [];

  for (const step of plan.steps) {
    const fail = (reason: string) => {
      failed.push({ eventName: step.eventName, reason });
    };

    if (step.wasLocked) {
      const unlocked = await unlockRound1Action(step.eventId);
      if (unlocked && "error" in unlocked) {
        fail(unlocked.error);
        continue;
      }
    }

    const reopened = await unlockJudgeSheetAction(step.eventId, step.judgeId, 1);
    if (reopened && "error" in reopened) {
      fail(reopened.error);
      continue;
    }

    const cutSet = await setRound2CutAction(step.eventId, step.to);
    if (cutSet && "error" in cutSet) {
      fail(cutSet.error);
      continue;
    }

    // The judge's own ranks, read back from the sheet they are still on. Handing
    // them straight to the writer re-submits what was already there rather than
    // composing a payload of our own — the only version of this that cannot alter
    // a placement while claiming to preserve it.
    const { entry, error: entryError } = await loadSheetEntry(step.eventId, step.judgeId);
    if (entryError || !entry) {
      fail(entryError ?? "That judge's sheet could not be read.");
      continue;
    }

    const resubmitted = await enterJudgeSheetAction(step.eventId, step.judgeId, entry.draft);
    if (resubmitted && "error" in resubmitted) {
      fail(resubmitted.error);
      continue;
    }

    if (step.wasLocked) {
      const relocked = await lockRound1Action(step.eventId);
      if (relocked && "error" in relocked) {
        fail(relocked.error);
        continue;
      }
    }

    changed.push({ eventName: step.eventName, from: step.from, to: step.to });
  }

  return {
    success: true as const,
    changed,
    failed,
    unchanged: plan.unchanged,
    summary: bulkCutSummary({
      changed: changed.length,
      failed: failed.length,
      unchanged: plan.unchanged,
    }),
  };
}
