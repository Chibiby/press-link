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
 * ## Why this exists before the schema does
 *
 * Migration 0018 has not run, so there is no `judges`, no `judge_assignments`
 * and no `judge_sheets` to read. That does not mean the index has to be faked:
 * `events` and `entries` are real and queryable today, and an event with an empty
 * panel is a state the finished feature has to handle anyway — it is what every
 * event looks like the morning before judging starts.
 *
 * So the placeholder pages pass `{}` for the facts, every event resolves through
 * {@link NO_JUDGING_FACTS}, and {@link eventJudgingStatus} — the real state
 * machine, not a stand-in — returns "not-started" with the reason "No judge is
 * assigned to this event yet." That sentence is true right now for a reason the
 * page is careful to name, and it will still be computed the same way when the
 * tables exist. Nothing here has to be unpicked later; the pages start passing
 * real facts instead of none.
 */

import { EVENT_SLOTS, slotKey } from "@/lib/dashboard/event-matrix";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

import { consolidateRound } from "./consolidate";
import { eventJudgingStatus } from "./sheet-state";
import type {
  ConsolidatedBoard,
  ContestUnit,
  EventJudgingState,
  EventRoundState,
  JudgeRank,
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
  /** Round 1's unit set: every contestant in the event. */
  units: ContestUnit[];
  round1Ranks: JudgeRank[];
  /** Round 2's unit set: the qualifiers drawn when round 1 closed. */
  round2Units: ContestUnit[];
  round2Ranks: JudgeRank[];
  rounds: EventRoundState;
  /**
   * `events.round2_cut`. null while the column does not exist — which is not the
   * same as 10, and must not be rendered as though the division had chosen it.
   */
  round2Cut: number | null;
}

/**
 * The facts for an event nothing is known about, because the tables that would
 * know are not there.
 *
 * Frozen so a caller cannot push a judge onto the shared empty panel by accident
 * and quietly change every other event's status in the same render.
 */
export const NO_JUDGING_FACTS: EventJudgingFacts = Object.freeze({
  judgeIds: Object.freeze([]) as unknown as string[],
  units: Object.freeze([]) as unknown as ContestUnit[],
  round1Ranks: Object.freeze([]) as unknown as JudgeRank[],
  round2Units: Object.freeze([]) as unknown as ContestUnit[],
  round2Ranks: Object.freeze([]) as unknown as JudgeRank[],
  rounds: Object.freeze({
    round1ClosedAt: null,
    round2CutUsed: null,
    resultsLockedAt: null,
  }) as EventRoundState,
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
  /** Seats filled on this event's panel. */
  panelSize: number;
  round1: ConsolidatedBoard;
  round2: ConsolidatedBoard;
  /** Status and the sentence to print under it, from the shared state machine. */
  state: EventJudgingState;
  round2Cut: number | null;
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
 * back to {@link NO_JUDGING_FACTS}, which is the same path the whole placeholder
 * takes. Both boards are consolidated even on the index, because the status
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

    const round1 = consolidateRound({
      round: 1,
      units: known.units,
      ranks: known.round1Ranks,
      judgeIds: known.judgeIds,
    });
    const round2 = consolidateRound({
      round: 2,
      units: known.round2Units,
      ranks: known.round2Ranks,
      judgeIds: known.judgeIds,
    });

    return {
      eventId: event.eventId,
      typeNameEn: event.typeNameEn,
      typeNameFil: event.typeNameFil,
      category: event.category,
      level: event.level,
      language: event.language,
      slotLabel: eventSlotLabel(event.level, event.language),
      entries: event.entries,
      panelSize: known.judgeIds.length,
      round1,
      round2,
      state: eventJudgingStatus({ rounds: known.rounds, round1, round2 }),
      round2Cut: known.round2Cut,
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
    locked: rows.filter((row) => row.state.status === "locked").length,
    notStarted: rows.filter((row) => row.state.status === "not-started").length,
  };
}
