/**
 * Confirms 0004 landed: the roster tables exist, entries reference them by id,
 * and event_types carries the per-event participant counts.
 *
 *   npx tsx --env-file=.env.local scripts/verify-roster-schema.ts
 */
import { createAdminClient } from "../lib/supabase/admin";

async function main() {
  const supabase = createAdminClient();
  const failures: string[] = [];

  const probes: { label: string; run: () => Promise<string | null> }[] = [
    {
      label: "participants table",
      run: async () => {
        const { error } = await supabase
          .from("participants")
          .select("id, school_id, participant_number, first_name, middle_name, last_name, gender")
          .limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "coaches table",
      run: async () => {
        const { error } = await supabase
          .from("coaches")
          .select("id, school_id, first_name, middle_name, last_name, gender")
          .limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "entry_participants.participant_id",
      run: async () => {
        const { error } = await supabase
          .from("entry_participants")
          .select("id, entry_id, participant_id")
          .limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "entry_coaches.coach_id",
      run: async () => {
        const { error } = await supabase
          .from("entry_coaches")
          .select("id, entry_id, coach_id")
          .limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "schools.paper_participation",
      run: async () => {
        const { error } = await supabase.from("schools").select("id, paper_participation").limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "event_types participant counts",
      run: async () => {
        const { data, error } = await supabase
          .from("event_types")
          .select("slug, min_participants, max_participants");
        if (error) return error.message;
        const bySlug = new Map((data ?? []).map((r) => [r.slug as string, r]));
        const seven = [
          "radio-broadcasting-regular",
          "radio-broadcasting-spj",
          "collaborative-publishing",
          "tv-broadcasting-regular",
          "tv-broadcasting-spj",
        ];
        for (const slug of seven) {
          const row = bySlug.get(slug);
          if (!row) return `missing event type ${slug}`;
          if (row.min_participants !== 7 || row.max_participants !== 7) {
            return `${slug} should be 7/7, got ${row.min_participants}/${row.max_participants}`;
          }
        }
        const online = bySlug.get("online-publishing");
        if (!online || online.min_participants !== 2 || online.max_participants !== null) {
          return `online-publishing should be 2/null, got ${online?.min_participants}/${online?.max_participants}`;
        }
        return null;
      },
    },
  ];

  for (const probe of probes) {
    const failure = await probe.run();
    if (failure) {
      failures.push(`${probe.label}: ${failure}`);
      console.log(`FAIL  ${probe.label}`);
    } else {
      console.log(`ok    ${probe.label}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nRoster schema verified.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
