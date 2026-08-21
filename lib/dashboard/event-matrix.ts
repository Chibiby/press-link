import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

export type EventSlotKey =
  | "elementary-english"
  | "elementary-filipino"
  | "secondary-english"
  | "secondary-filipino";

/**
 * The four columns, in the order the page prints them — and the single source of that
 * order. The page maps this array for its header row *and* for each body row's cells, so a
 * header cannot drift out of alignment with the numbers under it.
 */
export const EVENT_SLOTS = [
  { key: "elementary-english", level: "elementary", language: "english", label: "Elem · Eng" },
  { key: "elementary-filipino", level: "elementary", language: "filipino", label: "Elem · Fil" },
  { key: "secondary-english", level: "secondary", language: "english", label: "Sec · Eng" },
  { key: "secondary-filipino", level: "secondary", language: "filipino", label: "Sec · Fil" },
] as const satisfies readonly {
  key: EventSlotKey;
  level: EventLevel;
  language: EventLanguage;
  label: string;
}[];

export function slotKey(level: EventLevel, language: EventLanguage): EventSlotKey {
  return `${level}-${language}`;
}

/**
 * How a type's participant limits read in one cell.
 *
 * Three shapes, because the catalog has three: a fixed team (7), a range (1–3), and an open
 * upper bound (Online Publishing, min 2 and max null). "7–7" and "2–∞" are both worse than
 * a sentence, and this is the only place that decision is made.
 */
export function teamSize(row: {
  minParticipants: number;
  maxParticipants: number | null;
}): string {
  if (row.maxParticipants === null) return `${row.minParticipants} or more`;
  if (row.maxParticipants === row.minParticipants) return `${row.minParticipants}`;
  return `${row.minParticipants}–${row.maxParticipants}`;
}

/** One concrete event — a type at a level in a language — with its entry count. */
export interface EventMatrixInput {
  eventId: string;
  typeId: string;
  typeNameEn: string;
  typeNameFil: string;
  category: EventCategory;
  minParticipants: number;
  maxParticipants: number | null;
  /** `event_types.sort_order`, which is the order the whole admin area lists types in. */
  sortOrder: number;
  level: EventLevel;
  language: EventLanguage;
  entries: number;
}

export interface EventMatrixRow {
  typeId: string;
  typeNameEn: string;
  typeNameFil: string;
  category: EventCategory;
  minParticipants: number;
  maxParticipants: number | null;
  sortOrder: number;
  /** `null` where the contest is not offered at all — never a zero standing in for absence. */
  slots: Record<EventSlotKey, { eventId: string; entries: number } | null>;
  /** How many of the four slots exist. 4 for a both-levels type, 2 for a secondary-only one. */
  offered: number;
  entries: number;
}

export interface EventMatrix {
  individual: EventMatrixRow[];
  group: EventMatrixRow[];
  typesTotal: number;
  /** Types with at least one entry — the numerator of the dashboard's Events KPI. */
  typesWithEntries: number;
  eventsTotal: number;
  entriesTotal: number;
}

function emptySlots(): EventMatrixRow["slots"] {
  return {
    "elementary-english": null,
    "elementary-filipino": null,
    "secondary-english": null,
    "secondary-filipino": null,
  };
}

/**
 * Folds the event rows into one row per event type.
 *
 * Ordering is `event_types.sort_order`, so this page lists types in the same sequence as the
 * entry wizard and the events catalog. The rows arrive in whatever order PostgREST returns
 * them, which is why the sort happens here rather than being assumed.
 *
 * Every total is derived from the rows handed in — nothing here assumes how many events or
 * types the division currently runs, so seeding another contest needs no change here.
 */
export function buildEventMatrix(rows: EventMatrixInput[]): EventMatrix {
  const byType = new Map<string, EventMatrixRow>();

  for (const row of rows) {
    let type = byType.get(row.typeId);
    if (!type) {
      type = {
        typeId: row.typeId,
        typeNameEn: row.typeNameEn,
        typeNameFil: row.typeNameFil,
        category: row.category,
        minParticipants: row.minParticipants,
        maxParticipants: row.maxParticipants,
        sortOrder: row.sortOrder,
        slots: emptySlots(),
        offered: 0,
        entries: 0,
      };
      byType.set(row.typeId, type);
    }

    type.slots[slotKey(row.level, row.language)] = {
      eventId: row.eventId,
      entries: row.entries,
    };
    type.offered += 1;
    type.entries += row.entries;
  }

  const all = [...byType.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.typeNameEn.localeCompare(b.typeNameEn)
  );

  return {
    individual: all.filter((row) => row.category === "individual"),
    group: all.filter((row) => row.category === "group"),
    typesTotal: all.length,
    typesWithEntries: all.filter((row) => row.entries > 0).length,
    eventsTotal: rows.length,
    entriesTotal: rows.reduce((sum, row) => sum + row.entries, 0),
  };
}
