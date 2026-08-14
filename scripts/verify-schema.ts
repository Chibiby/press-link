import { createAdminClient } from "../lib/supabase/admin";

const TABLES = [
  "districts",
  "schools",
  "admin_profiles",
  "events",
  "school_papers",
  "paper_staff",
  "entries",
  "entry_participants",
  "entry_coaches",
];

async function main() {
  const supabase = createAdminClient();
  for (const table of TABLES) {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) {
      throw new Error(`Table check failed for "${table}": ${error.message}`);
    }
    console.log(`OK: ${table}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
