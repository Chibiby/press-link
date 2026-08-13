import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";
import { EntryDashboard } from "./EntryDashboard";
import type { EntryRow, SchoolPaperRow } from "./types";
import type { EventRow, EventTypeRow } from "./wizard-steps";
import { DashboardHeader } from "@/components/dashboard-header";

/** Formatted server-side so the client never re-derives a locale string. */
const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface RawEntry {
  id: string;
  event_id: string;
  submitted_at: string;
  events: {
    name: string;
    level: EntryRow["level"];
    language: EntryRow["language"];
    event_type_id: string;
  } | null;
  entry_participants: EntryRow["participants"];
  entry_coaches: EntryRow["coaches"];
}

export default async function EntryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: school } = await supabase
    .from("schools")
    .select("id, name, districts(name)")
    .eq("auth_user_id", user.id)
    .single<{ id: string; name: string; districts: { name: string } | null }>();

  if (!school) {
    redirect("/login");
  }

  const [{ data: settings }, { data: papers }, { data: types }, { data: events }, { data: rawEntries }] =
    await Promise.all([
      supabase.from("app_settings").select("submissions_locked").single(),
      supabase
        .from("school_papers")
        .select(
          "id, language, paper_name, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title)"
        )
        .eq("school_id", school.id)
        .overrideTypes<SchoolPaperRow[]>(),
      supabase
        .from("event_types")
        .select("id, slug, category, name_en, name_fil, sort_order")
        .order("sort_order")
        .overrideTypes<EventTypeRow[]>(),
      supabase
        .from("events")
        .select("id, event_type_id, category, level, language, name, sort_order")
        .order("sort_order")
        .overrideTypes<EventRow[]>(),
      supabase
        .from("entries")
        .select(
          "id, event_id, submitted_at, events(name, level, language, event_type_id), entry_participants(first_name, middle_name, last_name, gender), entry_coaches(full_name, gender)"
        )
        .eq("school_id", school.id)
        .order("submitted_at", { ascending: false })
        .overrideTypes<RawEntry[]>(),
    ]);

  const entries: EntryRow[] = (rawEntries ?? []).map((row) => ({
    id: row.id,
    event_id: row.event_id,
    submitted_at: row.submitted_at,
    submitted_label: row.submitted_at
      ? DATE_FORMAT.format(new Date(row.submitted_at))
      : "—",
    event_type_id: row.events?.event_type_id ?? "",
    event_name: row.events?.name ?? "Unknown event",
    level: row.events?.level ?? "elementary",
    language: row.events?.language ?? "english",
    participants: row.entry_participants ?? [],
    coaches: row.entry_coaches ?? [],
  }));

  const locked = settings?.submissions_locked ?? false;

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title={school.name}
        subtitle={school.districts?.name}
        badge={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
        signOutAction={signOutAction}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <EntryDashboard
          entries={entries}
          types={types ?? []}
          events={events ?? []}
          papers={papers ?? []}
          locked={locked}
        />
      </main>
    </div>
  );
}
