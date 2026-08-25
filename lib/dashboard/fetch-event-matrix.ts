import { buildEventMatrix, type EventMatrix, type EventMatrixInput } from "@/lib/dashboard/event-matrix";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import type { SupabaseServerClient } from "@/lib/supabase/server";

export interface CatalogEventRow {
  id: string;
  level: EventLevel;
  language: EventLanguage;
  event_types: {
    id: string;
    name_en: string;
    name_fil: string;
    category: EventCategory;
    min_participants: number;
    max_participants: number | null;
    sort_order: number;
  } | null;
  entries: { id: string; entry_participants: { count: number }[] }[];
}

/**
 * The one query behind /admin/events, and its own export route — so a
 * downloaded workbook can never disagree with the screen it was downloaded
 * from. Both callers guard differently (a page redirects, a route handler
 * must answer JSON), which is why this takes a client rather than building
 * one; see `fetchSchoolFacts` for the same split.
 *
 * Reports failure rather than throwing, the same shape the page already
 * handled inline before this was extracted: a failed query would otherwise
 * leave every count computing to zero, which reads as "the division runs no
 * events" rather than as "the catalogue could not be loaded".
 */
export async function fetchEventMatrix(
  supabase: SupabaseServerClient
): Promise<{ matrix: EventMatrix } | { error: true }> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, level, language, event_types(id, name_en, name_fil, category, min_participants, max_participants, sort_order), entries(id, entry_participants(count))"
    )
    .overrideTypes<CatalogEventRow[]>();

  if (error) return { error: true };

  const rows: EventMatrixInput[] = (data ?? []).flatMap((row) => {
    // events.event_type_id is NOT NULL since migration 0003, so a null type here is a
    // broken key rather than an unclassified event — dropped, not printed unlabelled.
    if (!row.event_types) return [];

    // A submission is one row in `entries` regardless of how many named participants it
    // carries; a participant is one row in `entry_participants` under it. Individual
    // contests want the second count (three named entrants on one entry is three, not
    // one) and group contests want the first (a 7-member team is one entry, not seven) —
    // so both are computed here and `event_types.category` below picks between them.
    const submissionCount = row.entries?.length ?? 0;
    const participantCount = (row.entries ?? []).reduce(
      (sum, entry) => sum + (entry.entry_participants?.[0]?.count ?? 0),
      0
    );

    return [
      {
        eventId: row.id,
        typeId: row.event_types.id,
        typeNameEn: row.event_types.name_en,
        typeNameFil: row.event_types.name_fil,
        category: row.event_types.category,
        minParticipants: row.event_types.min_participants,
        maxParticipants: row.event_types.max_participants,
        sortOrder: row.event_types.sort_order,
        level: row.level,
        language: row.language,
        entries: row.event_types.category === "individual" ? participantCount : submissionCount,
      },
    ];
  });

  return { matrix: buildEventMatrix(rows) };
}
