import { cache } from "react";

import { requireAdmin } from "@/app/admin/guard";
import {
  LANGUAGE_LABEL,
  type EventCategory,
  type EventLanguage,
  type EventLevel,
} from "@/lib/events-catalog";
import {
  buildEventIndex,
  type EventIndexRow,
  type RawIndexEvent,
} from "@/lib/judging/event-index";

/**
 * `lib/events-catalog.ts` exports `levelTag()` — "elem" / "sec", for building event
 * codes — but no prose label. `dashboard-data.ts` owns a private one for the same
 * reason this file does: the catalog stays the single source of truth for event
 * data, and a full-word label is presentation.
 *
 * The compact "Elem · Eng" form belongs to the index tables and lives in
 * `eventSlotLabel`; this longer form is for a detail page's heading, where there
 * is room and no column to line up with.
 */
const LEVEL_LABEL: Record<EventLevel, string> = {
  elementary: "Elementary",
  secondary: "Secondary",
};

export function eventFullLabel(level: EventLevel, language: EventLanguage): string {
  return `${LEVEL_LABEL[level]} · ${LANGUAGE_LABEL[language]}`;
}

interface RawEventRow {
  id: string;
  level: EventLevel;
  language: EventLanguage;
  event_types: {
    name_en: string;
    name_fil: string;
    category: EventCategory;
    sort_order: number;
  } | null;
  entries: { count: number }[];
}

export interface JudgingEventIndex {
  rows: EventIndexRow[];
  /**
   * Set when the catalog query failed.
   *
   * Reported rather than swallowed: an empty `rows` would render "0 events" and
   * every figure above it as a zero, which claims the division runs no contests
   * (non-negotiable 5). The pages branch on this before drawing anything.
   */
  error: string | null;
}

/**
 * Every event, with its judging state.
 *
 * `cache` so the two adjudication index pages and a detail page opened from one of
 * them share a single round trip per request, the way `loadDashboardData` does.
 *
 * ## Why no judging facts are passed
 *
 * Migration 0018 has not run, so `judges`, `judge_assignments`, `judge_sheets`,
 * `judge_ranks`, `round2_qualifiers` and `event_rounds` are not queryable. This
 * loader therefore passes no facts at all, and `buildEventIndex` falls every event
 * back to `NO_JUDGING_FACTS`.
 *
 * That is a deliberate absence rather than a stub: the status each event shows is
 * computed by the real `eventJudgingStatus` over a real empty panel, so it reads
 * "Not started — No judge is assigned to this event yet", which is true today and
 * will be produced by the same code path once the tables exist. When they do, the
 * change here is to fetch the facts and pass them in. Nothing above this function
 * has to move.
 */
export const loadJudgingEventIndex = cache(async (): Promise<JudgingEventIndex> => {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from("events")
    .select(
      "id, level, language, event_types(name_en, name_fil, category, sort_order), entries(count)"
    )
    .overrideTypes<RawEventRow[]>();

  if (error) return { rows: [], error: error.message };

  const raw: RawIndexEvent[] = (data ?? []).flatMap((row) =>
    // events.event_type_id is NOT NULL since migration 0003, so a null type here is
    // a broken key rather than an unclassified event — dropped, not printed
    // unlabelled, exactly as the events page does it.
    row.event_types
      ? [
          {
            eventId: row.id,
            typeNameEn: row.event_types.name_en,
            typeNameFil: row.event_types.name_fil,
            category: row.event_types.category,
            level: row.level,
            language: row.language,
            sortOrder: row.event_types.sort_order,
            entries: row.entries?.[0]?.count ?? 0,
          },
        ]
      : []
  );

  return { rows: buildEventIndex(raw), error: null };
});

/**
 * One event's index row, for a detail page.
 *
 * Served from {@link loadJudgingEventIndex} rather than its own query so a detail
 * page cannot show a different status from the row that linked to it — and, since
 * the loader is `cache`d, so opening a detail page costs no extra round trip. The
 * catalog is a few dozen rows; a dedicated single-row query would buy nothing and
 * would be a second place for the join to drift.
 */
export const loadJudgingEvent = cache(
  async (eventId: string): Promise<{ row: EventIndexRow | null; error: string | null }> => {
    const { rows, error } = await loadJudgingEventIndex();
    if (error) return { row: null, error };
    return { row: rows.find((row) => row.eventId === eventId) ?? null, error: null };
  }
);
