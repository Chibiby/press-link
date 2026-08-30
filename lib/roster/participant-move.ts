import { EVENT_SLOTS } from "@/lib/dashboard/event-matrix";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

import { capReason, type ParticipantUsage } from "./limits";

/**
 * Moving one contestant from the event a school entered them in to the event they
 * should have been entered in.
 *
 * The mistake this exists for is a school's, not a judge's or an admin's: a
 * learner filed under News Writing who was meant to be in Editorial Writing. Until
 * now the only fix was to reopen the school — either lifting the division-wide
 * lock for everybody or granting that one school a revision window — and wait for
 * them to redo it. That is the right tool when the school has several things to
 * correct, and much too heavy for one contestant in the wrong contest.
 *
 * ## What is pure here and what is not
 *
 * These functions decide **what may be offered and what must be said**. They do
 * not decide whether a move is allowed — `admin_move_participant_event`
 * (migration 0034) re-checks every rule below server-side, which is where the
 * boundary is. What is here is the half a screen needs and the database cannot
 * give it: which destinations to grey out and why, and the sentences that name a
 * consequence *before* the admin commits to it.
 */

/** One contest a participant could be moved into. */
export interface MoveEventOption {
  id: string;
  name: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
}

/** One entry a participant currently sits in, as the menu shows it. */
export interface ParticipantEntrySummary {
  entryId: string;
  eventId: string;
  eventName: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  /** The other contestants on the entry, surname first. Empty on a solo individual entry. */
  teammates: string[];
  /** The coaches named on the entry, surname first. */
  coachNames: string[];
  /**
   * The coach paired with **this** contestant on this entry, not the entry's coaches
   * at large.
   *
   * The distinction is the whole point on a group entry, where the coaches are the
   * team's and none of them is this contestant's in particular — so both are null
   * there. On an individual entry 0019 pairs exactly one, and it is the one a move
   * defaults to carrying: the coach who prepared this contestant for one contest is
   * the coach who prepares them for the next.
   */
  coachId: string | null;
  coachName: string | null;
  /**
   * The fewest contestants this entry's event allows, from `event_types`. Carried
   * here so `moveConsequences` can say what taking one out would leave behind
   * without the dialog fetching the catalog a second time.
   */
  minParticipants: number;
  /**
   * Whether a judge has already ranked in this entry's event. Carried on the entry
   * rather than looked up by the dialog so the menu can mark a judged event without
   * a second round trip.
   */
  judged: boolean;
}

/**
 * "Elem · Eng", from the same array the dashboard's matrix heads its columns with.
 *
 * Not a fifth hand-written copy of the four labels: a move dialog that called
 * elementary "Elementary" while every table beside it said "Elem" would read as a
 * different level rather than as the same one spelled out.
 */
export function slotLabel(level: EventLevel, language: EventLanguage): string {
  return (
    EVENT_SLOTS.find((slot) => slot.level === level && slot.language === language)?.label ??
    `${level} · ${language}`
  );
}

/** "News Writing · Elem · Eng" — a contest named the way the admin sees it listed. */
export function eventOptionLabel(event: {
  name: string;
  level: EventLevel;
  language: EventLanguage;
}): string {
  return `${event.name} · ${slotLabel(event.level, event.language)}`;
}

/**
 * How many entries of each category this participant holds, counting everything
 * except the entry they are being moved out of.
 *
 * The exclusion is the point. A learner already in their second individual event is
 * at the cap, but moving *one of those two* to a different individual event does not
 * make a third — and counting it would refuse the correction this feature exists to
 * make.
 */
export function usageExcluding(
  entries: ParticipantEntrySummary[],
  exceptEntryId: string
): ParticipantUsage {
  const usage: ParticipantUsage = { individualCount: 0, groupCount: 0 };
  for (const entry of entries) {
    if (entry.entryId === exceptEntryId) continue;
    if (entry.category === "individual") usage.individualCount += 1;
    else usage.groupCount += 1;
  }
  return usage;
}

export interface MoveDestination {
  event: MoveEventOption;
  label: string;
  /** null when the move may be attempted; a sentence naming the obstacle otherwise. */
  disabledReason: string | null;
}

/**
 * Every contest, in catalog order, with the ones this participant cannot be moved
 * into marked and the reason attached.
 *
 * Marked rather than filtered out. An admin looking for Editorial Writing and not
 * finding it in the list learns nothing; finding it greyed out with "already
 * entered" beside it learns the thing they came to find out. The one exception is
 * the entry's own event, which is dropped: "move to where they already are" is not
 * an option that needs explaining.
 *
 * Level and language are **not** filtered. `schools.level` is nullable and
 * advisory — it is null for every integrated school, which teaches both — so
 * filtering on it would hide the correct destination for exactly the schools most
 * likely to need one. The label carries the level instead, and the admin reads it.
 */
export function moveDestinations(
  events: MoveEventOption[],
  entries: ParticipantEntrySummary[],
  sourceEntryId: string
): MoveDestination[] {
  const source = entries.find((entry) => entry.entryId === sourceEntryId);
  const usage = usageExcluding(entries, sourceEntryId);
  const enteredEventIds = new Set(
    entries.filter((entry) => entry.entryId !== sourceEntryId).map((entry) => entry.eventId)
  );

  return events
    .filter((event) => event.id !== source?.eventId)
    .map((event) => ({
      event,
      label: eventOptionLabel(event),
      disabledReason: enteredEventIds.has(event.id)
        ? "Already entered in this event"
        : capReason(usage, event.category),
    }));
}

export interface MoveConsequenceInput {
  /** The entry being moved out of. */
  source: ParticipantEntrySummary;
  destination: MoveEventOption;
  /** Whether the school already has an entry in the destination event. */
  destinationEntryExists: boolean;
  /** Whether a judge has ranked in the destination event. */
  destinationJudged: boolean;
  /** How many contestants the source entry holds, this one included. */
  sourceMemberCount: number;
  /** The fewest the source event's entry may hold. */
  sourceMinParticipants: number;
}

/**
 * What will happen if this move goes through, in the order it matters.
 *
 * Every sentence here is a fact the admin cannot see on the row they clicked, and
 * each one is the kind of thing that is only ever noticed afterwards: an entry that
 * disappears, a rank that stops counting, a team that drops below its minimum. The
 * dialog prints them and asks again.
 *
 * An empty list means the move is unremarkable, and the dialog says so rather than
 * showing an empty warning box.
 */
export function moveConsequences(input: MoveConsequenceInput): string[] {
  const {
    source,
    destination,
    destinationEntryExists,
    destinationJudged,
    sourceMemberCount,
    sourceMinParticipants,
  } = input;
  const notes: string[] = [];

  if (sourceMemberCount <= 1) {
    notes.push(
      `${source.eventName} will have no contestants left from this school, so that entry will be deleted.`
    );
  } else if (sourceMemberCount - 1 < sourceMinParticipants) {
    // Reported as a consequence rather than silently refused here: the RPC refuses
    // it, and a dialog that greys out the button without saying why sends the admin
    // looking for a fault in the form.
    notes.push(
      `${source.eventName} needs at least ${sourceMinParticipants} contestants and would be left with ${
        sourceMemberCount - 1
      }. This move will be refused — remove the whole entry instead, or move another contestant in first.`
    );
  }

  if (source.judged) {
    notes.push(
      `A judge has already ranked in ${source.eventName}. This contestant's ranks there will be discarded, and any standings drawn from them will change.`
    );
  }

  if (destinationJudged) {
    notes.push(
      `A judge has already ranked in ${destination.name}. This contestant joins it unranked, so that sheet will be incomplete until it is reopened and ranked again.`
    );
  }

  if (!destinationEntryExists) {
    notes.push(
      `This school has no ${destination.name} entry yet, so one will be created for it.`
    );
  }

  return notes;
}
