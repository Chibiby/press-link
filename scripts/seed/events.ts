import { fileURLToPath } from "node:url";
import { createAdminClient } from "../../lib/supabase/admin";
import { EVENT_TYPES, EVENTS_CATALOG } from "../../lib/events-catalog";

export async function seedEvents() {
  const supabase = createAdminClient();

  // 1. Event types.
  const { error: typesError } = await supabase.from("event_types").upsert(
    EVENT_TYPES.map((t) => ({
      slug: t.slug,
      category: t.category,
      name_en: t.nameEn,
      name_fil: t.nameFil,
      min_participants: t.minParticipants,
      max_participants: t.maxParticipants,
      sort_order: t.sortOrder,
    })),
    { onConflict: "slug" }
  );
  if (typesError) {
    throw new Error(`Failed to seed event_types: ${typesError.message}`);
  }

  // 2. Map slug -> id so events can carry the FK.
  const { data: typeRows, error: typeReadError } = await supabase
    .from("event_types")
    .select("id, slug");
  if (typeReadError) {
    throw new Error(`Failed to read event_types: ${typeReadError.message}`);
  }
  const typeIdBySlug = new Map<string, string>(
    (typeRows ?? []).map((row) => [row.slug as string, row.id as string])
  );
  for (const type of EVENT_TYPES) {
    if (!typeIdBySlug.has(type.slug)) {
      throw new Error(`event_types row missing after upsert: ${type.slug}`);
    }
  }

  // 3. Events.
  const { error: eventsError } = await supabase.from("events").upsert(
    EVENTS_CATALOG.map((e) => ({
      code: e.code,
      event_type_id: typeIdBySlug.get(e.eventTypeSlug)!,
      category: e.category,
      level: e.level,
      language: e.language,
      name: e.name,
      sort_order: e.sortOrder,
    })),
    { onConflict: "code" }
  );
  if (eventsError) {
    throw new Error(`Failed to seed events: ${eventsError.message}`);
  }

  // 4. Drop rows that no longer exist in the catalog — v1 seeded the six
  //    secondary-only group contests as `{slug}-{lang}` instead of
  //    `{slug}-sec-{lang}`. Deleting an event with entries attached would
  //    lose submissions, so refuse to run destructively.
  const validCodes = EVENTS_CATALOG.map((e) => e.code);
  const { data: staleRows, error: staleReadError } = await supabase
    .from("events")
    .select("id, code")
    .not("code", "in", `(${validCodes.join(",")})`);
  if (staleReadError) {
    throw new Error(`Failed to look up stale events: ${staleReadError.message}`);
  }

  if (staleRows && staleRows.length > 0) {
    const staleIds = staleRows.map((row) => row.id as string);
    const { count: attachedEntries, error: entryCountError } = await supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .in("event_id", staleIds);
    if (entryCountError) {
      throw new Error(`Failed to count entries on stale events: ${entryCountError.message}`);
    }
    if (attachedEntries && attachedEntries > 0) {
      throw new Error(
        `Refusing to delete ${staleRows.length} stale event(s): ${attachedEntries} entr(ies) reference them. ` +
          `Repoint those entries at the normalized codes first.\n` +
          `Stale codes: ${staleRows.map((r) => r.code).join(", ")}`
      );
    }

    const { error: deleteError } = await supabase.from("events").delete().in("id", staleIds);
    if (deleteError) {
      throw new Error(`Failed to delete stale events: ${deleteError.message}`);
    }
    console.log(
      `Removed ${staleRows.length} stale event(s): ${staleRows.map((r) => r.code).join(", ")}`
    );
  }

  console.log(`Seeded ${EVENT_TYPES.length} event types and ${EVENTS_CATALOG.length} events.`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  seedEvents().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
