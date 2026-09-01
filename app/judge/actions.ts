"use server";

import { revalidatePath } from "next/cache";

import { checkJudge } from "@/app/judge/guard";
import { loadJudgeSheet } from "@/app/judge/judge-data";
import { sheetEditable } from "@/lib/judging/sheet-state";
import { toRankPayload, validateSheetDraft, type RankDraft } from "@/lib/judging/sheet-form";

/**
 * Submitting a sheet, which is also locking it — the division's "once naka rank,
 * i-lock". A judge cannot revise afterwards; an admin unlocks
 * (`admin_unlock_judge_sheet`).
 *
 * ## Why this re-reads the sheet instead of trusting the form
 *
 * The payload arrives from a client, so the unit set, the round, the cut and
 * whether this sheet is still editable are all re-derived here from the database
 * rather than read out of the form. A form that has been open while an admin
 * moved the cut, or while round 1 was locked, would otherwise submit against
 * numbers that are no longer true.
 *
 * This is still not the authorisation boundary. `judge_submit_sheet` re-checks
 * the seat, the round, the submission and every rank server-side (non-negotiable
 * 2), and a judge who forges a request past this function is refused there. What
 * this adds is a sentence naming the row that is wrong, which the RPC cannot give.
 */
export async function submitJudgeSheetAction(
  eventId: string,
  draft: RankDraft
): Promise<{ error: string } | void> {
  const check = await checkJudge();
  if (!check.isJudge) {
    return { error: "You are not signed in as a judge. Sign in again and retry." };
  }

  const { sheet, error } = await loadJudgeSheet(eventId);
  if (error) {
    return { error: `${error} Your sheet was not submitted. Please try again.` };
  }
  if (!sheet) {
    return { error: "You are not assigned to this event." };
  }
  if (!sheetEditable(sheet.state)) {
    return { error: sheet.state.reason };
  }

  const invalid = validateSheetDraft(sheet.spec, sheet.units, draft);
  if (invalid) return { error: invalid };

  const { error: rpcError } = await check.supabase.rpc("judge_submit_sheet", {
    p_event_id: eventId,
    p_round: sheet.round,
    p_ranks: toRankPayload(draft),
  });

  if (rpcError) {
    // The RPC's own refusals are the last word, and they are worth showing: they
    // name a rule this action could not have known was broken — a sheet
    // submitted from another tab a moment ago, a round locked mid-edit.
    return { error: `Your sheet was not submitted: ${rpcError.message}` };
  }

  revalidatePath("/judge");
  revalidatePath(`/judge/${eventId}`);
}

/**
 * Save a part-finished sheet without submitting it.
 *
 * The sibling of {@link submitJudgeSheetAction}, and the difference is the whole
 * point: this one does not lock. A judge reading fifteen contestants off paper can
 * put the tablet down after eight and come back to the eight already there.
 *
 * ## Why it validates less
 *
 * `validateSheetDraft` is not called. It enforces the rules a *finished* sheet has
 * to satisfy — every qualifier placed in round 2, at least one contestant ranked in
 * round 1 — and a draft is by definition the state before those hold. What is still
 * checked, by `judge_save_draft` itself, is everything structural: the seat, the
 * round, whether the sheet is already submitted, that every key is a contestant in
 * this event, and that every rank is inside the round's bounds. A draft may be
 * incomplete; it may not be wrong.
 *
 * The sheet is still re-read here rather than trusted from the form, for the reason
 * the submit action gives: a form open while an admin closed the round would
 * otherwise write against numbers that stopped being true while it sat there.
 */
export async function saveJudgeSheetDraftAction(
  eventId: string,
  draft: RankDraft
): Promise<{ error: string } | void> {
  const check = await checkJudge();
  if (!check.isJudge) {
    return { error: "You are not signed in as a judge. Sign in again and retry." };
  }

  const { sheet, error } = await loadJudgeSheet(eventId);
  if (error) {
    return { error: `${error} Your sheet was not saved. Please try again.` };
  }
  if (!sheet) {
    return { error: "You are not assigned to this event." };
  }
  if (!sheetEditable(sheet.state)) {
    return { error: sheet.state.reason };
  }

  const { error: rpcError } = await check.supabase.rpc("judge_save_draft", {
    p_event_id: eventId,
    p_round: sheet.round,
    p_ranks: toRankPayload(draft),
  });

  if (rpcError) {
    return { error: `Your sheet was not saved: ${rpcError.message}` };
  }

  revalidatePath("/judge");
  revalidatePath(`/judge/${eventId}`);
}
