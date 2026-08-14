import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

/** An `event_types` row as fetched by the entry page. */
export interface EventTypeRow {
  id: string;
  slug: string;
  category: EventCategory;
  name_en: string;
  name_fil: string;
  min_participants: number;
  max_participants: number | null;
  sort_order: number;
}

/** An `events` row as fetched by the entry page. */
export interface EventRow {
  id: string;
  event_type_id: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  name: string;
  sort_order: number;
}

const LEVEL_ORDER: EventLevel[] = ["elementary", "secondary"];
const LANGUAGE_ORDER: EventLanguage[] = ["english", "filipino"];

/**
 * The wizard narrows Category -> Level -> Language -> Event, so every step
 * filters the same catalog by whichever fields are known so far. An omitted
 * field matches everything.
 */
export interface EventFilter {
  category?: EventCategory;
  level?: EventLevel;
  language?: EventLanguage;
  typeId?: string;
}

export function eventsMatching(events: EventRow[], filter: EventFilter): EventRow[] {
  return events.filter(
    (e) =>
      (filter.category === undefined || e.category === filter.category) &&
      (filter.level === undefined || e.level === filter.level) &&
      (filter.language === undefined || e.language === filter.language) &&
      (filter.typeId === undefined || e.event_type_id === filter.typeId)
  );
}

/** Levels this category is genuinely offered at — never a dead option. */
export function levelsFor(events: EventRow[], category: EventCategory): EventLevel[] {
  const found = new Set(eventsMatching(events, { category }).map((e) => e.level));
  return LEVEL_ORDER.filter((level) => found.has(level));
}

export function languagesFor(
  events: EventRow[],
  category: EventCategory,
  level: EventLevel
): EventLanguage[] {
  const found = new Set(eventsMatching(events, { category, level }).map((e) => e.language));
  return LANGUAGE_ORDER.filter((language) => found.has(language));
}

/** The contests actually held at this level and language, in catalog order. */
export function typesFor(
  types: EventTypeRow[],
  events: EventRow[],
  category: EventCategory,
  level: EventLevel,
  language: EventLanguage
): EventTypeRow[] {
  const offered = new Set(
    eventsMatching(events, { category, level, language }).map((e) => e.event_type_id)
  );
  return types
    .filter((t) => offered.has(t.id))
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function resolveEvent(
  events: EventRow[],
  typeId: string,
  level: EventLevel,
  language: EventLanguage
): EventRow | undefined {
  return events.find(
    (e) => e.event_type_id === typeId && e.level === level && e.language === language
  );
}

/**
 * The events this school has already entered. A school gets one entry per
 * event, and an `events` row is already unique per contest/level/language, so
 * an event id in this set means that exact combination is spoken for.
 * `currentEntryId` drops the entry being edited, which would otherwise block
 * its own re-save.
 */
export function takenEventIdsFor(
  entries: { id: string; event_id: string }[],
  currentEntryId: string | null
): Set<string> {
  return new Set(
    entries.filter((e) => e.id !== currentEntryId).map((e) => e.event_id)
  );
}

/** True when this exact contest/level/language already has an entry. */
export function isEventTaken(
  events: EventRow[],
  typeId: string,
  level: EventLevel,
  language: EventLanguage,
  taken: Set<string>
): boolean {
  const event = resolveEvent(events, typeId, level, language);
  return event !== undefined && taken.has(event.id);
}

/**
 * True when every event under this filter is already submitted — used to grey
 * out a whole level or language once nothing is left beneath it. A filter that
 * matches no events is not "fully taken"; it simply isn't offered.
 */
export function isEveryEventTaken(
  events: EventRow[],
  filter: EventFilter,
  taken: Set<string>
): boolean {
  const matches = eventsMatching(events, filter);
  return matches.length > 0 && matches.every((e) => taken.has(e.id));
}

export function typeLabel(type: EventTypeRow): { primary: string; secondary?: string } {
  return type.name_en === type.name_fil
    ? { primary: type.name_en }
    : { primary: type.name_en, secondary: type.name_fil };
}
