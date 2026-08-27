/**
 * Choosing an event to seat a judge on, one narrowing question at a time.
 *
 * The panel page seats judges the other way round — you are already on an event and
 * you fill its seats. This is the roster's way: you have a judge in front of you and
 * you are placing them across the contests they will judge, which is how a division
 * actually staffs a panel.
 *
 * ## Why language is asked as its own question
 *
 * An `events` row is a contest **type**, a level and a language, so "Editorial
 * Writing" names four of them. A single flat list of every event is therefore four
 * lines of near-identical text per contest, distinguished only by a suffix — and
 * picking the English one when you meant the Filipino one is a mistake that shows up
 * much later, as a judge who cannot find the event they were told to judge. Asking
 * for the language separately makes the ambiguity a question rather than a trap.
 *
 * ## Why this is pure
 *
 * The cascade has rules — a language that only exists for some contests, a level with
 * no event under the chosen pair, a seat already taken, a judge who cannot sit twice
 * on one event — and each of them is a way for the dialog to offer something the
 * database will refuse. Deciding them here, with tests, is what keeps the dialog
 * honest without making it the authority: `admin_assign_judge` re-checks every one
 * server-side (non-negotiable 2).
 */

import type { EventLanguage, EventLevel } from "@/lib/events-catalog";

import { ROUND1_SEAT, ROUND2_SEATS } from "./sheet-state";

/** One seat on an event, and who is on it. */
export interface SeatHolder {
  seat: number;
  judgeId: string;
  /** Shown when offering to replace them, so the choice names a person. */
  judgeName: string;
}

/** An individual event a judge could be seated on. */
export interface SeatableEvent {
  eventId: string;
  typeNameEn: string;
  level: EventLevel;
  language: EventLanguage;
  seats: SeatHolder[];
}

/** How far down the cascade the reader has got. Empty string means unanswered. */
export interface SeatChoice {
  contest: string;
  language: EventLanguage | "";
  level: EventLevel | "";
}

export const EMPTY_SEAT_CHOICE: SeatChoice = { contest: "", language: "", level: "" };

/** One of the four seats, as the picker offers it. */
export interface SeatOption {
  seat: number;
  /** 1 for seat 1, 2 for the rest (N1). */
  round: number;
  /** The judge already on it, or null when it is vacant. Choosing it replaces them. */
  occupiedBy: string | null;
}

export interface SeatPicker {
  /** Contest names, deduplicated and alphabetical. */
  contests: string[];
  /** The languages this contest is actually run in. Empty until a contest is chosen. */
  languages: EventLanguage[];
  /** The levels under the chosen contest and language. */
  levels: EventLevel[];
  /** The event all three answers resolve to, or null while any is outstanding. */
  event: SeatableEvent | null;
  /** The four seats on that event. Empty until there is an event. */
  seats: SeatOption[];
  /**
   * Why no seat may be chosen on the resolved event, or null when one may.
   *
   * The only case today is a judge already seated here. 0018's unique
   * `(judge_id, event_id)` is what stops the judge who made the cut also placing the
   * winners, so offering their other seats and letting the database refuse would be
   * offering a move that is not a move.
   */
  blocked: string | null;
}

/** The four seats in the order the rounds are worked through (N1). */
const SEATS: readonly number[] = [ROUND1_SEAT, ...ROUND2_SEATS];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Everything the dialog draws, from the events on file and the answers so far.
 *
 * One function rather than four, because the lists are not independent: choosing a
 * language can empty the level list, and choosing a level can only ever resolve
 * against the pair above it. Returning them together means a caller cannot render a
 * level list computed before the language changed.
 *
 * A stale answer narrows nothing rather than throwing. Changing the contest usually
 * leaves the old language selected and no longer valid; `languages` then simply does
 * not contain it and `event` stays null, which renders as an unanswered question —
 * the same thing the reader has to do about it either way.
 */
export function seatPicker(
  events: SeatableEvent[],
  choice: SeatChoice,
  /** The judge being seated, so their own existing seat is not offered as a target. */
  judgeId: string
): SeatPicker {
  const contests = unique(events.map((event) => event.typeNameEn)).sort((a, b) =>
    a.localeCompare(b)
  );

  const inContest = events.filter((event) => event.typeNameEn === choice.contest);
  // Filipino before English is not the order anyone expects; the catalog's own order
  // is english then filipino, and `unique` preserves first appearance, so the list
  // comes out in whatever order the events arrived. Sorted so it cannot depend on
  // that: English, then Filipino, every time.
  const languages = unique(inContest.map((event) => event.language)).sort((a, b) =>
    a.localeCompare(b)
  );

  const inLanguage = inContest.filter((event) => event.language === choice.language);
  // "elementary" before "secondary" alphabetically, which is also the order the
  // division lists them in.
  const levels = unique(inLanguage.map((event) => event.level)).sort((a, b) =>
    a.localeCompare(b)
  );

  const event = inLanguage.find((candidate) => candidate.level === choice.level) ?? null;

  if (!event) {
    return { contests, languages, levels, event: null, seats: [], blocked: null };
  }

  const held = event.seats.find((seat) => seat.judgeId === judgeId) ?? null;

  return {
    contests,
    languages,
    levels,
    event,
    seats: SEATS.map((seat) => {
      const holder = event.seats.find((taken) => taken.seat === seat) ?? null;
      return {
        seat,
        round: seat === ROUND1_SEAT ? 1 : 2,
        occupiedBy: holder?.judgeName ?? null,
      };
    }),
    blocked: held
      ? `This judge already sits on seat ${held.seat} of this event, and one judge cannot hold two seats on one event. Empty that seat on the event's own page to move them.`
      : null,
  };
}
