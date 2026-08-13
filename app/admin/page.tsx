import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FilterBar } from "./FilterBar";
import { LockToggle } from "./LockToggle";

interface SearchParams {
  district?: string;
  school?: string;
  event?: string;
  category?: string;
  language?: string;
}

interface EntryRow {
  id: string;
  submitted_at: string;
  schools: { name: string; district_id: string; districts: { name: string } | null } | null;
  events: { name: string; category: string; level: string; language: string } | null;
  entry_participants: { first_name: string; last_name: string }[];
  entry_coaches: { full_name: string }[];
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase.from("admin_profiles").select("user_id").eq("user_id", user.id).single();
  if (!profile) {
    await supabase.auth.signOut();
    redirect("/admin/login");
  }

  const [{ data: districts }, { data: schools }, { data: events }, { data: settings }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
    supabase.from("events").select("id, name").order("sort_order"),
    supabase.from("app_settings").select("submissions_locked").single(),
  ]);

  let query = supabase
    .from("entries")
    .select(
      "id, submitted_at, schools(name, district_id, districts(name)), events(name, category, level, language), entry_participants(first_name, last_name), entry_coaches(full_name)"
    )
    .order("submitted_at", { ascending: false });

  if (params.school) query = query.eq("school_id", params.school);
  if (params.event) query = query.eq("event_id", params.event);

  const { data: rawEntries } = await query.overrideTypes<EntryRow[]>();

  const filteredEntries = (rawEntries ?? []).filter((entry) => {
    if (params.district && entry.schools?.district_id !== params.district) return false;
    if (params.category && entry.events?.category !== params.category) return false;
    if (params.language && entry.events?.language !== params.language) return false;
    return true;
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Press Link Admin</h1>
        <LockToggle locked={settings?.submissions_locked ?? false} />
      </div>

      <FilterBar districts={districts ?? []} schools={schools ?? []} events={events ?? []} />

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">School</th>
            <th className="py-2">District</th>
            <th className="py-2">Event</th>
            <th className="py-2">Category</th>
            <th className="py-2">Level</th>
            <th className="py-2">Language</th>
            <th className="py-2">Participant(s)</th>
            <th className="py-2">Coach(es)</th>
            <th className="py-2">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {filteredEntries.map((entry) => (
            <tr key={entry.id} className="border-b">
              <td className="py-2">{entry.schools?.name}</td>
              <td className="py-2">{entry.schools?.districts?.name}</td>
              <td className="py-2">{entry.events?.name}</td>
              <td className="py-2">{entry.events?.category}</td>
              <td className="py-2">{entry.events?.level}</td>
              <td className="py-2">{entry.events?.language}</td>
              <td className="py-2">
                {entry.entry_participants.map((p) => `${p.first_name} ${p.last_name}`).join(", ")}
              </td>
              <td className="py-2">{entry.entry_coaches.map((c) => c.full_name).join(", ")}</td>
              <td className="py-2">{new Date(entry.submitted_at).toLocaleString()}</td>
            </tr>
          ))}
          {filteredEntries.length === 0 && (
            <tr>
              <td colSpan={9} className="py-4 text-center text-gray-500">
                No entries match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
