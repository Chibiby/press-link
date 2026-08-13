import { fileURLToPath } from "node:url";
import { createAdminClient } from "../../lib/supabase/admin";
import { EVENTS_CATALOG } from "../../lib/events-catalog";

export async function seedEvents() {
  const supabase = createAdminClient();
  const { error } = await supabase.from("events").upsert(
    EVENTS_CATALOG.map((e) => ({
      code: e.code,
      category: e.category,
      level: e.level,
      language: e.language,
      name: e.name,
      sort_order: e.sortOrder,
    })),
    { onConflict: "code" }
  );
  if (error) {
    throw new Error(`Failed to seed events: ${error.message}`);
  }
  console.log(`Seeded ${EVENTS_CATALOG.length} events.`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  seedEvents().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
