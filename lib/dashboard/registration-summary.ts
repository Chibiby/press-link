import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

/** A learner or a coach as this page prints them: already formatted, never re-derived. */
export interface RegistrationPerson {
  id: string;
  /** Surname-first, from `surnameFirst`. Built on the server so no two rows can disagree. */
  name: string;
  /** `participants.participant_number`, the division-wide learner id. Coaches have none. */
  number: number | null;
}

/** One entry a school has on record, with the people named in it. */
export interface RegistrationEntry {
  entryId: string;
  eventId: string;
  eventName: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  /** `events.sort_order` — the catalog's own ordering, which this module sorts by. */
  sortOrder: number;
  submittedAt: string;
  participants: RegistrationPerson[];
  coaches: RegistrationPerson[];
}

export interface RegistrationSummary {
  /** Catalog order, so the sheet reads the way the events list does. */
  entries: RegistrationEntry[];
  entryCount: number;
  /** Distinct learners named across every entry. A learner in two events counts once. */
  learnersEntered: number;
  /** Distinct coaches, likewise. */
  coachesEntered: number;
}

/**
 * Orders one school's entries and counts the people in them.
 *
 * The counting is why this is a module and not three lines in the page. `entries.length`
 * counts entries, and summing `participants.length` counts a learner once per event they
 * compete in — neither answers "how many learners are entered", which is what the sheet
 * claims. Distinct ids are the only honest answer, and they have a test.
 *
 * Ordering is `events.sort_order`, the catalog's own sequence, with the event name and then
 * the entry id as tie-breaks so the order is total and two renders of the same rows cannot
 * differ. In practice the first key decides it: `entries_school_event_unique`
 * (migration 0005) means one school never holds two entries in one event.
 */
export function summariseRegistration(entries: RegistrationEntry[]): RegistrationSummary {
  const learners = new Set<string>();
  const coaches = new Set<string>();

  for (const entry of entries) {
    for (const person of entry.participants) learners.add(person.id);
    for (const coach of entry.coaches) coaches.add(coach.id);
  }

  return {
    // A copy, not `entries.sort()`: the caller's array is the query result, and a pure
    // function does not reorder its input out from under whoever else reads it.
    entries: [...entries].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.eventName.localeCompare(b.eventName) ||
        a.entryId.localeCompare(b.entryId)
    ),
    entryCount: entries.length,
    learnersEntered: learners.size,
    coachesEntered: coaches.size,
  };
}
