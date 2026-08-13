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

export function typesForCategory(
  types: EventTypeRow[],
  category: EventCategory
): EventTypeRow[] {
  return types
    .filter((t) => t.category === category)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Levels this contest is genuinely offered at — never a dead option. */
export function levelsForType(events: EventRow[], typeId: string): EventLevel[] {
  const found = new Set(
    events.filter((e) => e.event_type_id === typeId).map((e) => e.level)
  );
  return LEVEL_ORDER.filter((level) => found.has(level));
}

export function languagesFor(
  events: EventRow[],
  typeId: string,
  level: EventLevel
): EventLanguage[] {
  const found = new Set(
    events
      .filter((e) => e.event_type_id === typeId && e.level === level)
      .map((e) => e.language)
  );
  return LANGUAGE_ORDER.filter((language) => found.has(language));
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

export function typeLabel(type: EventTypeRow): { primary: string; secondary?: string } {
  return type.name_en === type.name_fil
    ? { primary: type.name_en }
    : { primary: type.name_en, secondary: type.name_fil };
}
