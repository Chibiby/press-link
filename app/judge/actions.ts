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
