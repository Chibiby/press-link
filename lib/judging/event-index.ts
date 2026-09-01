/**
 * The per-event index both adjudication pages are built on.
 *
 * `/admin/judges` and `/admin/tabulators` open on the same list of events asking
 * two different questions of it — "who is on this panel and how far have they
 * got" and "what does this event's sheet say" — so the row is built once here.
 * Two pages deriving the same status from the same facts in two files is how they
 * drift, and the status is the one thing on both pages that must agree.
 *
 * Pure, like the rest of `lib/judging`: no Supabase and no React. The caller does
 * the reading and hands the facts in.
 *
 * ## Why an event may still have no facts
 *
 * `facts` is keyed by event id and the lookup falls back to
 * {@link NO_JUDGING_FACTS}, which is not a stand-in for a missing table — the six
 * judging tables exist. It is the shape of an event nobody has started judging,
 * which is what every event looks like the morning before the contest, and a state
 * the finished feature has to handle for its own sake.
 *
 * An event that resolves through it gets its status from {@link eventJudgingStatus}
 * like any other: "not-started", because the panel it was handed is genuinely
 * empty. The distinction that matters on screen is between that and a failed read,
 * and the loader raises the second rather than passing an empty record for it.
 */

import { EVENT_SLOTS, slotKey } from "@/lib/dashboard/event-matrix";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

import { consolidateRound } from "./consolidate";
import { round1Board, type Round1Board } from "./cut";
import { eventJudgingStatus } from "./sheet-state";
import { finalStandings } from "./standings";
import type {
  ConsolidatedBoard,
  ContestUnit,
  EventJudgingState,
  EventRoundState,
  JudgeRank,
  StandingRow,
} from "./types";

/** One event as the index reads it, already flattened out of the join. */
export interface RawIndexEvent {
  eventId: string;
  typeNameEn: string;
  typeNameFil: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  /** `event_types.sort_order`, so the index lists contests in catalog order. */
  sortOrder: number;
  /**
   * Entries on file for this event.
   *
   * Deliberately named `entries` and not `contestants`: an individual event ranks
   * each participant on an entry separately, so its contestant count is larger
   * than its entry count, and only `contestUnits` can say by how much. Calling
   * this "contestants" on screen would understate every individual event.
   */
  entries: number;
  /**
   * Individuals competing in this event: every contestant named on every entry.
   *
   * The figure a tabulator counts heads with, and not the same question as
   * {@link RawIndexEvent.entries}. One school files one entry and may put three
   * contestants on it, so an entry count answers "how many schools are in this
   * contest" — which is a fact about the paperwork, not about the field.
   *
   * Counted for both categories the same way, over `entry_participants`. A group
   * event ranks the team rather than its members, so this is larger than its unit
   * set; it is still the number of learners in the room, which is what the column
   * is read for.
   */
  contestants: number;
}

/**
 * Everything the judging schema would say about one event.
 *
 * A single object rather than six arguments because the caller either has all of
 * it — one query per table, joined by event — or none of it, and the "none"
 * case wants a single named value it can point at.
 */
export interface EventJudgingFacts {
  /** The panel, in seat order. Empty means nobody is assigned. */
  judgeIds: string[];
  /**
   * The seat-1 judge, who ranks round 1 alone (N1), or null when that seat is
   * empty.
   *
   * Named rather than taken as `judgeIds[0]`, because a panel seated 2, 3 and 4
   * with seat 1 still vacant would otherwise put the round 2 panel's first judge
   * in charge of the cut.
   */
  round1JudgeId: string | null;
  /**
   * When the seat-1 judge submitted their round 1 sheet, or null.
   *
   * Round 1's completeness is a fact about the sheet and never about the board
   * (N6): a cut leaves most rows deliberately blank (N2), so no count of filled
   * rows can tell you the judge has finished.
   */
  round1SubmittedAt: string | null;
  /** Round 1's unit set: every contestant in the event. */
  units: ContestUnit[];
  round1Ranks: JudgeRank[];
  /** Round 2's unit set: the qualifiers drawn when round 1 closed. */
  round2Units: ContestUnit[];
  round2Ranks: JudgeRank[];
  rounds: EventRoundState;
  /**
   * `events.round2_cut`, which is `not null default 30`. null therefore means the
   * value could not be read — which is not the same as 10, and must not be rendered
   * as though the division had chosen it.
   */
  round2Cut: number | null;
}

/**
 * The facts for an event nobody has started judging: no panel, no ranks, no closed
 * round.
 *
 * Frozen so a caller cannot push a judge onto the shared empty panel by accident
 * and quietly change every other event's status in the same render.
 */
export const NO_JUDGING_FACTS: EventJudgingFacts = Object.freeze({
  judgeIds: Object.freeze([]) as unknown as string[],
  round1JudgeId: null,
  round1SubmittedAt: null,
  units: Object.freeze([]) as unknown as ContestUnit[],
  round1Ranks: Object.freeze([]) as unknown as JudgeRank[],
  round2Units: Object.freeze([]) as unknown as ContestUnit[],
  round2Ranks: Object.freeze([]) as unknown as JudgeRank[],
  // No `as EventRoundState` here, deliberately. A frozen object is assignable to
  // the mutable interface on its own, so leaving the assertion off keeps the
  // contextual check: the day `EventRoundState` gains a field, this literal fails
  // to compile instead of silently handing every unjudged event an `undefined`
  // that reads as "not null" — which is exactly how `round1LockedAt` once made
  // every factless event report round 2 as open.
  rounds: Object.freeze({
    round1ClosedAt: null,
    round1LockedAt: null,
    round2CutUsed: null,
    resultsLockedAt: null,
  }),
  round2Cut: null,
});

export interface EventIndexRow {
  eventId: string;
  typeNameEn: string;
  typeNameFil: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  /** "Elem · Eng" — the label the events matrix already prints for this pair. */
  slotLabel: string;
  entries: number;
  /** Individuals on those entries — see {@link RawIndexEvent.contestants}. */
  contestants: number;
  /** Seats filled on this event's panel. */
  panelSize: number;
  round1: ConsolidatedBoard;
  /**
   * Round 1 as the round actually is under N1: one judge's typed ranks, with a
   * blank meaning eliminated rather than outstanding.
   *
   * This, not {@link EventIndexRow.round1}, is what the cut rule and the
   * standings read, and it is why they work at all. `consolidateRound` cannot
   * express round 1: it treats an unranked unit as a missing opinion and refuses
   * to rank anything (non-negotiable 4), so a cut — which leaves most rows blank
   * on purpose (N2) — makes the panel board permanently incomplete and its every
   * rank null. Drawing qualifiers off that board yields nobody, every time.
   *
   * `round1` is kept beside it because the panel board is still what the boards
   * table renders and what a group event genuinely is. null here for a group
   * event, which has no single-judge round 1 (non-negotiable 6).
   */
  round1Cut: Round1Board | null;
  round2: ConsolidatedBoard;
  /** Status and the sentence to print under it, from the shared state machine. */
  state: EventJudgingState;
  round2Cut: number | null;
  /**
   * Every contestant with both rounds' points, ranks and official placement, from
   * {@link finalStandings}.
   *
   * Carried on the row rather than recomputed by the event's own page, so the
   * `placed` column below and the sheet that page draws are the same array and cannot
   * disagree about a placement. Still **anonymous** — a standing carries a contest
   * code, never a name; `attachIdentities` is what turns these into a tabulator's
   * sheet, and only the tabulators' surfaces call it (non-negotiable 1).
   *
   * null, not empty, when no cut is on file: with no cut there is no field to divide,
   * and an empty array here would read as an event with no contestants.
   */
  standings: StandingRow[] | null;
  /**
   * Contestants who have an official placement — {@link finalStandings}' `finalRank`,
   * counted.
   *
   * Under N4 only a qualifier has a placement: a non-qualifier was eliminated in
   * round 1 and carries no final rank at all, rather than being placed in a block
   * beneath the qualifiers as the 2026-08-21 contract had it. So this stays at 0
   * until round 2 completes and then jumps to the qualifier count — it does not
   * rise in two steps. Locking publishes those placements, it does not compute
   * them, so it is not 0 merely because the results are unlocked either.
   *
   * Counted off {@link EventIndexRow.standings}, which is also what
   * `tabulationSummary` counts once the identities are joined on, so this column and
   * the event's own sheet cannot report different numbers. null only when no cut is
   * on file, since without one there is no field to place.
   */
  placed: number | null;
}

/**
 * The label the events matrix already uses for a level-and-language pair.
 *
 * Looked up from `EVENT_SLOTS` rather than composed from `levelTag`/`langTag`,
 * so "Elem · Eng" is written down in exactly one place and the adjudication
 * pages cannot start saying "Elementary / English" while the events page says
 * something shorter.
 */
export function eventSlotLabel(level: EventLevel, language: EventLanguage): string {
  const key = slotKey(level, language);
  const slot = EVENT_SLOTS.find((candidate) => candidate.key === key);
  // `slotKey` builds its result from the same two closed unions EVENT_SLOTS
  // enumerates, so every key has a slot. The fallback exists to keep the return
  // type a plain string rather than force every caller through a null check.
  return slot?.label ?? key;
}

/**
 * One index row per event, in catalog order.
 *
 * `facts` is keyed by event id and may be partial — an event with no entry falls
 * back to {@link NO_JUDGING_FACTS}, the unjudged state. Both boards are
 * consolidated even on the index, because the status
 * sentence quotes progress ("3 of 20 ranks filed") and `boardProgress` needs a
 * board to count.
 */
export function buildEventIndex(
  events: RawIndexEvent[],
  facts: Record<string, EventJudgingFacts> = {}
): EventIndexRow[] {
  // Catalog order, then the slot order the events page uses, so a contest's four
  // events sit together and always in the same sequence.
  //
  // Sorted here, on the raw events, rather than on the finished rows: the order is
  // a fact about `event_types.sort_order`, not about the view, so sorting first
  // means `sortOrder` never has to ride along on an `EventIndexRow` just to be
  // stripped off again. Copied before sorting because `sort` mutates in place and
  // the caller's array is not ours to reorder.
  const slotOrder = new Map(EVENT_SLOTS.map((slot, index) => [slot.key, index]));
  const ordered = [...events].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.typeNameEn !== b.typeNameEn) return a.typeNameEn.localeCompare(b.typeNameEn);
    const aSlot = slotOrder.get(slotKey(a.level, a.language)) ?? 0;
    const bSlot = slotOrder.get(slotKey(b.level, b.language)) ?? 0;
    return aSlot - bSlot;
  });

  return ordered.map((event) => {
    const known = facts[event.eventId] ?? NO_JUDGING_FACTS;

    // `round2_cut_used` is the cut round 1 was actually closed under and it wins
    // where it exists: `events.round2_cut` is live and an admin may move it
    // afterwards, and standings drawn under a cut nobody competed under would
    // reshuffle a settled field. Before round 1 closes there is nothing recorded,
    // so the live column is the only cut there is.
    const cutInForce = known.rounds.round2CutUsed ?? known.round2Cut;

    const round1 = consolidateRound({
      round: 1,
      units: known.units,
      ranks: known.round1Ranks,
      judgeIds: known.judgeIds,
    });
    const round2 = consolidateRound({
      round: 2,
      units: known.round2Units,
      // Seats 2 to 4 place the qualifiers, and seat 1 does not (N1). Consolidating
      // over the whole panel would hold round 2 open forever waiting on a sheet
      // the round 1 judge is never asked to file.
      judgeIds: known.judgeIds.filter((judgeId) => judgeId !== known.round1JudgeId),
      ranks: known.round2Ranks,
    });

    // Round 1's own board, for individual events. A group event has no
    // single-judge round 1 and keeps the panel board it has always had
    // (non-negotiable 6).
    const round1Cut =
      event.category === "group"
        ? null
        : round1Board(
            known.units,
            // Seat 1's ranks alone. A stray round 1 rank from another seat cannot
            // be written through the RPCs, so this filter is defensive — but a
            // rank that did get through would otherwise become a qualifier.
            known.round1JudgeId === null
              ? []
              : known.round1Ranks.filter((rank) => rank.judgeId === known.round1JudgeId)
          );

    const round1Field = round1Cut ?? round1;

    const standings =
      cutInForce === null
        ? null
        : finalStandings({ round1: round1Field, round2, cut: cutInForce });

    return {
      eventId: event.eventId,
      typeNameEn: event.typeNameEn,
      typeNameFil: event.typeNameFil,
      category: event.category,
      level: event.level,
      language: event.language,
      slotLabel: eventSlotLabel(event.level, event.language),
      entries: event.entries,
      contestants: event.contestants,
      panelSize: known.judgeIds.length,
      round1,
      round1Cut,
      round2,
      state: eventJudgingStatus({
        rounds: known.rounds,
        // The one judge's board where there is one, and `complete` from their
        // submission rather than from a full sheet — a cut is finished with rows
        // still blank (N2, N6). A group event keeps the panel reading.
        round1:
          round1Cut === null
            ? round1
            : {
                rows: round1Cut.rows,
                judgeIds: known.round1JudgeId === null ? [] : [known.round1JudgeId],
                complete: known.round1SubmittedAt !== null,
              },
        round2,
      }),
      round2Cut: known.round2Cut,
      standings,
      placed:
        standings === null
          ? null
          : standings.filter((standing) => standing.finalRank !== null).length,
    };
  });
}

/**
 * The figures above the index table.
 *
 * Counted off the rows the table renders rather than queried separately, so a
 * headline and the list under it cannot disagree — the same rule the dashboard's
 * per-school panel follows.
 */
export function eventIndexSummary(rows: EventIndexRow[]): {
  events: number;
  entries: number;
  withPanel: number;
  /** Events where the panel has finished and an admin has to act. */
  awaitingAction: number;
  /**
   * Units drawn into round 2 across every event.
   *
   * Counted off `round2.rows`, which is consolidated from the qualifier set, so
   * this headline and each event's Qualifiers cell cannot disagree.
   */
  qualifiers: number;
  /**
   * Contestants with an official placement, across every event.
   *
   * A sum of what was measured. An event whose cut could not be read contributes
   * nothing and is counted in `withoutCut` instead, rather than being folded in as a
   * nought — which would put a smaller number here than the division has actually
   * placed and give no sign of it (non-negotiable 5).
   */
  placed: number;
  /** Events with no round-2 cut on file, so with no field that could be placed. */
  withoutCut: number;
  locked: number;
  notStarted: number;
} {
  return {
    events: rows.length,
    entries: rows.reduce((sum, row) => sum + row.entries, 0),
    withPanel: rows.filter((row) => row.panelSize > 0).length,
    awaitingAction: rows.filter(
      (row) =>
        row.state.status === "round1-awaiting-close" ||
        row.state.status === "round2-awaiting-lock"
    ).length,
    qualifiers: rows.reduce((sum, row) => sum + row.round2.rows.length, 0),
    placed: rows.reduce((sum, row) => sum + (row.placed ?? 0), 0),
    withoutCut: rows.filter((row) => row.placed === null).length,
    locked: rows.filter((row) => row.state.status === "locked").length,
    notStarted: rows.filter((row) => row.state.status === "not-started").length,
  };
}
