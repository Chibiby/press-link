import { createAdminClient } from "../lib/supabase/admin";
import { EVENT_TYPES, EVENTS_CATALOG } from "../lib/events-catalog";

const CODE_SHAPE = /^[a-z0-9-]+-(elem|sec)-(eng|fil)$/;

async function main() {
  const supabase = createAdminClient();
  const failures: string[] = [];

  const { data: types, error: typesError } = await supabase
    .from("event_types")
    .select("id, slug, category, name_en, name_fil, sort_order");
  if (typesError) throw new Error(`event_types read failed: ${typesError.message}`);

  if (types!.length !== EVENT_TYPES.length) {
    failures.push(`event_types count is ${types!.length}, expected ${EVENT_TYPES.length}`);
  }

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id, code, event_type_id, category, level, language, name");
  if (eventsError) throw new Error(`events read failed: ${eventsError.message}`);

  if (events!.length !== EVENTS_CATALOG.length) {
    failures.push(`events count is ${events!.length}, expected ${EVENTS_CATALOG.length}`);
  }

  const missingFk = events!.filter((e) => !e.event_type_id);
  if (missingFk.length > 0) {
    failures.push(`${missingFk.length} event(s) have a null event_type_id`);
  }

  const badCodes = events!.filter((e) => !CODE_SHAPE.test(e.code as string));
  if (badCodes.length > 0) {
    failures.push(`malformed codes: ${badCodes.map((e) => e.code).join(", ")}`);
  }

  const dbCodes = new Set(events!.map((e) => e.code as string));
  const missing = EVENTS_CATALOG.filter((e) => !dbCodes.has(e.code)).map((e) => e.code);
  if (missing.length > 0) failures.push(`missing codes: ${missing.join(", ")}`);

  const catalogCodes = new Set(EVENTS_CATALOG.map((e) => e.code));
  const extra = [...dbCodes].filter((c) => !catalogCodes.has(c));
  if (extra.length > 0) failures.push(`unexpected codes: ${extra.join(", ")}`);

  if (failures.length > 0) {
    console.error("FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(`OK: ${types!.length} event types, ${events!.length} events, all codes normalized.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
