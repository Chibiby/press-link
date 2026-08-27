import { cache } from "react";

import { requireJudge } from "@/app/judge/guard";
import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import { eventSlotLabel } from "@/lib/judging/event-index";
import { qualifierNotice } from "@/lib/judging/qualifiers";
import { ROUND1_SEAT, judgeSheetState } from "@/lib/judging/sheet-state";
import { draftFromRanks, sheetFormSpec, type RankDraft, type SheetFormSpec } from "@/lib/judging/sheet-form";
import type {
  ContestUnit,
  EventRoundState,
  JudgeSheetState,
  JudgingRound,
  QualifierRow,
} from "@/lib/judging/types";
import { LoadFailure, fetchAll } from "@/lib/supabase/fetch-all";

/**
 * Everything the judge portal reads, and nothing an admin page reads.
 *
 * Kept apart from `app/admin/(shell)/judging-data.ts` deliberately rather than
 * sharing its loaders. That file selects names, schools and districts, and a
 * shared module is one import away from a judge screen acquiring them
 * (non-negotiable 1). The overlap is the pure `lib/judging` core, which is where
 * it belongs.
 *
 * ## Where each fact comes from
 *
 * The panel, the sheets and the round state arrive as plain selects, because
 * migration 0018's row level security already scopes each of them to the
 * signed-in judge: their own assignments, their own sheets, their own ranks, and
 * the round state of events they are seated on. `events` and `event_types` are
 * publicly readable, so the contest's name and its cut need no special path.
 *
 * The **codes** are the exception, and the only thing here that goes through an
 * RPC. Building one requires `participants.participant_number`, a judge has no
 * select on `participants`, and they must never have one — so
 * `judge_event_units` and `judge_round2_units` (migration 0028) are the sole
 * route by which a contest code reaches a judge's screen.
 *
 * ## Failures render as failures
 *
 * Every loader returns `{ ..., error }` rather than throwing, and every caller
 * has an error branch that says the read failed. A judge shown an empty sheet
 * because a query broke would rank nobody and report the event as having no
 * contestants (non-negotiable 5).
 */

/** Which round this judge sits on, from their seat (N1). */
export function roundForSeat(seat: number): JudgingRound | null {
  if (seat === ROUND1_SEAT) return 1;
  if (seat === 2 || seat === 3 || seat === 4) return 2;
  return null;
}

interface RawJudgeEventRow {
  id: string;
  level: EventLevel;
  language: EventLanguage;
  round2_cut: number;
  category: string;
  event_types: { name_en: string; name_fil: string; sort_order: number } | null;
}

interface RawSheetRow {
  event_id: string;
  round: number;
  submitted_at: string | null;
}

interface RawRoundRow {
  event_id: string;
  round1_closed_at: string | null;
  round1_locked_at: string | null;
  round2_cut_used: number | null;
  results_locked_at: string | null;
}

interface RawUnitRow {
  unit_key: string;
  code: string;
  entry_id: string;
  participant_id: string | null;
}

/** One event on the judge's own list. */
export interface JudgeEventRow {
  eventId: string;
  typeNameEn: string;
  typeNameFil: string;
  slotLabel: string;
  seat: number;
  /** The round this seat judges. Null when the seat is outside 1–4, a data fault. */
  round: JudgingRound | null;
  /** Whether this judge may edit, only view, or not reach this event's sheet. */
  state: JudgeSheetState;
  submittedAt: string | null;
}

const EMPTY_ROUNDS: EventRoundState = {
  round1ClosedAt: null,
  round1LockedAt: null,
  round2CutUsed: null,
  resultsLockedAt: null,
};

function roundStateOf(row: RawRoundRow | undefined): EventRoundState {
  if (!row) return EMPTY_ROUNDS;
  return {
    round1ClosedAt: row.round1_closed_at,
    round1LockedAt: row.round1_locked_at,
    round2CutUsed: row.round2_cut_used,
    resultsLockedAt: row.results_locked_at,
  };
}

/**
 * The events this judge is seated on, in catalog order.
 *
 * Cached per request because the list page and its heading both want it, and a
 * page that reads it twice must not ask the database twice.
 */
export const loadJudgeEvents = cache(
  async (): Promise<{ rows: JudgeEventRow[]; error: string | null }> => {
    const { supabase, judgeId } = await requireJudge();

    try {
      const assignments = await fetchAll<{ event_id: string; seat: number }>(
        "Your events",
        (from, to) =>
          supabase
            .from("judge_assignments")
            .select("event_id, seat")
            .eq("judge_id", judgeId)
            .order("event_id")
            .range(from, to)
            .overrideTypes<{ event_id: string; seat: number }[]>()
      );

      if (assignments.length === 0) return { rows: [], error: null };

      const eventIds = assignments.map((row) => row.event_id);

      const [events, sheets, rounds] = await Promise.all([
        fetchAll<RawJudgeEventRow>("Your events", (from, to) =>
          supabase
            .from("events")
            .select("id, level, language, round2_cut, category, event_types(name_en, name_fil, sort_order)")
            .in("id", eventIds)
            .order("id")
            .range(from, to)
            .overrideTypes<RawJudgeEventRow[]>()
        ),
        fetchAll<RawSheetRow>("Your sheets", (from, to) =>
          supabase
            .from("judge_sheets")
            .select("event_id, round, submitted_at")
            .eq("judge_id", judgeId)
            .order("event_id")
            .range(from, to)
            .overrideTypes<RawSheetRow[]>()
        ),
        fetchAll<RawRoundRow>("Round state", (from, to) =>
          supabase
            .from("event_rounds")
            .select("event_id, round1_closed_at, round1_locked_at, round2_cut_used, results_locked_at")
            .in("event_id", eventIds)
            .order("event_id")
            .range(from, to)
            .overrideTypes<RawRoundRow[]>()
        ),
      ]);

      const eventById = new Map(events.map((row) => [row.id, row]));
      const roundsById = new Map(rounds.map((row) => [row.event_id, row]));
      const sheetByKey = new Map(sheets.map((row) => [`${row.event_id}:${row.round}`, row]));

      const rows: JudgeEventRow[] = [];
      for (const assignment of assignments) {
        const event = eventById.get(assignment.event_id);
        // events.event_type_id has been NOT NULL since 0003, so a missing type is
        // a broken key rather than an unclassified contest. Dropped rather than
        // rendered unlabelled, exactly as the admin events page does it.
        if (!event?.event_types) continue;

        const round = roundForSeat(assignment.seat);
        const rounds = roundStateOf(roundsById.get(assignment.event_id));
        const submittedAt =
          round === null ? null : (sheetByKey.get(`${assignment.event_id}:${round}`)?.submitted_at ?? null);

        rows.push({
          eventId: event.id,
          typeNameEn: event.event_types.name_en,
          typeNameFil: event.event_types.name_fil,
          slotLabel: eventSlotLabel(event.level, event.language),
          seat: assignment.seat,
          round,
          // A seat outside 1–4 cannot judge any round, and judgeSheetState says
          // so for whichever round is asked. Round 1 is passed as the question
          // because it is the one a seatless row would otherwise be assumed into.
          state: judgeSheetState({
            round: round ?? 1,
            rounds,
            assigned: true,
            seat: assignment.seat,
            submittedAt,
          }),
          submittedAt,
        });
      }

      rows.sort(
        (a, b) =>
          (eventById.get(a.eventId)?.event_types?.sort_order ?? 0) -
            (eventById.get(b.eventId)?.event_types?.sort_order ?? 0) ||
          a.typeNameEn.localeCompare(b.typeNameEn) ||
          a.slotLabel.localeCompare(b.slotLabel)
      );

      return { rows, error: null };
    } catch (error) {
      if (error instanceof LoadFailure) return { rows: [], error: error.message };
      throw error;
    }
  }
);

/** One event's ranking sheet, as this judge may see it. */
export interface JudgeSheetView {
  eventId: string;
  typeNameEn: string;
  typeNameFil: string;
  slotLabel: string;
  seat: number;
  round: JudgingRound;
  state: JudgeSheetState;
  units: ContestUnit[];
  spec: SheetFormSpec;
  draft: RankDraft;
  /** The sentence explaining a qualifying field that is not the size of the cut. */
  notice: string | null;
}

/**
 * The sheet for one event, or null when this judge is not seated on it.
 *
 * Null and a failed read are separated: null means the judge has no seat here
 * and the page 404s, `error` means the read did not complete and the page says
 * so. Rendering the second as the first would tell a judge an event they were
 * assigned to does not exist.
 */
export async function loadJudgeSheet(
  eventId: string
): Promise<{ sheet: JudgeSheetView | null; error: string | null }> {
  const { supabase, judgeId } = await requireJudge();

  try {
    const { data: assignment, error: assignmentError } = await supabase
      .from("judge_assignments")
      .select("seat")
      .eq("judge_id", judgeId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (assignmentError) {
      throw new LoadFailure(`Your seat on this event could not be read: ${assignmentError.message}`);
    }
    if (!assignment) return { sheet: null, error: null };

    const round = roundForSeat(assignment.seat);
    if (round === null) return { sheet: null, error: null };

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, level, language, round2_cut, category, event_types(name_en, name_fil)")
      .eq("id", eventId)
      .maybeSingle<RawJudgeEventRow>();

    if (eventError) throw new LoadFailure(`This event could not be read: ${eventError.message}`);
    if (!event?.event_types) return { sheet: null, error: null };

    const { data: roundRow, error: roundError } = await supabase
      .from("event_rounds")
      .select("event_id, round1_closed_at, round1_locked_at, round2_cut_used, results_locked_at")
      .eq("event_id", eventId)
      .maybeSingle<RawRoundRow>();

    if (roundError) throw new LoadFailure(`This event's round state could not be read: ${roundError.message}`);
    const rounds = roundStateOf(roundRow ?? undefined);

    const { data: sheetRow, error: sheetError } = await supabase
      .from("judge_sheets")
      .select("id, submitted_at")
      .eq("judge_id", judgeId)
      .eq("event_id", eventId)
      .eq("round", round)
      .maybeSingle<{ id: string; submitted_at: string | null }>();

    if (sheetError) throw new LoadFailure(`Your sheet could not be read: ${sheetError.message}`);

    const state = judgeSheetState({
      round,
      rounds,
      assigned: true,
      seat: assignment.seat,
      submittedAt: sheetRow?.submitted_at ?? null,
    });

    // The codes. The one read that cannot be a plain select, because a judge has
    // no select on `participants` — see the module comment.
    const { data: unitRows, error: unitError } = await supabase.rpc(
      round === 1 ? "judge_event_units" : "judge_round2_units",
      { p_event_id: eventId }
    );

    if (unitError) {
      throw new LoadFailure(`This event's contestants could not be read: ${unitError.message}`);
    }

    const units: ContestUnit[] = ((unitRows ?? []) as RawUnitRow[]).map((row) => ({
      unitKey: row.unit_key,
      code: row.code,
      entryId: row.entry_id,
      participantId: row.participant_id,
    }));

    // This judge's own saved ranks. `judge_ranks` has no event or round of its
    // own — it carries a sheet, and the sheet carries both — so with no sheet row
    // yet there is nothing to read and the draft opens blank.
    let saved: { unitKey: string; rank: number }[] = [];
    if (sheetRow) {
      const rankRows = await fetchAll<{ entry_id: string; participant_id: string | null; rank: number }>(
        "Your ranks",
        (from, to) =>
          supabase
            .from("judge_ranks")
            .select("entry_id, participant_id, rank")
            .eq("sheet_id", sheetRow.id)
            .order("entry_id")
            .range(from, to)
            .overrideTypes<{ entry_id: string; participant_id: string | null; rank: number }[]>()
      );
      saved = rankRows.map((row) => ({
        unitKey: row.participant_id ?? row.entry_id,
        rank: row.rank,
      }));
    }

    // The cut that produced the field wins over the live column, for the same
    // reason the admin index prefers it: an admin may move `events.round2_cut`
    // after a qualifier list exists, and a dropdown built on the new number would
    // offer ranks the list was never drawn under.
    const size = round === 1 ? (rounds.round2CutUsed ?? event.round2_cut) : units.length;

    // Round 2's notice needs the round 1 working, which this judge deliberately
    // cannot read — so it is written from the field size against the cut alone.
    // `round1Rank` is not available here and the tie clause it drives is left to
    // the admin surfaces, which have the board.
    const cutInForce = rounds.round2CutUsed ?? event.round2_cut;
    const notice =
      round === 2
        ? qualifierNotice(
            units.map<QualifierRow>((unit) => ({
              unitKey: unit.unitKey,
              code: unit.code,
              entryId: unit.entryId,
              participantId: unit.participantId,
              round1Points: 0,
              round1Rank: 0,
            })),
            cutInForce
          )
        : null;

    return {
      sheet: {
        eventId: event.id,
        typeNameEn: event.event_types.name_en,
        typeNameFil: event.event_types.name_fil,
        slotLabel: eventSlotLabel(event.level, event.language),
        seat: assignment.seat,
        round,
        state,
        units,
        spec: sheetFormSpec(round, size),
        draft: draftFromRanks(units, saved),
        notice,
      },
      error: null,
    };
  } catch (error) {
    if (error instanceof LoadFailure) return { sheet: null, error: error.message };
    throw error;
  }
}
