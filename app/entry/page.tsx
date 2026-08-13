import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SchoolPaperForm, type ExistingPaper } from "./SchoolPaperForm";
import { EntryList, type Entry } from "./EntryList";
import { signOutAction } from "./actions";

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

  const [{ data: settings }, { data: papers }, { data: events }, { data: entries }] = await Promise.all([
    supabase.from("app_settings").select("submissions_locked").single(),
    supabase
      .from("school_papers")
      .select(
        "id, language, paper_name, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title)"
      )
      .eq("school_id", school.id),
    supabase.from("events").select("id, category, level, language, name").order("sort_order"),
    supabase
      .from("entries")
      .select(
        "id, submitted_at, events(name), entry_participants(first_name, middle_name, last_name, gender), entry_coaches(full_name, gender)"
      )
      .eq("school_id", school.id)
      .order("submitted_at", { ascending: false }),
  ]);

  const locked = settings?.submissions_locked ?? false;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{school.name}</h1>
          <p className="text-sm text-gray-500">{school.districts?.name}</p>
        </div>
        <form action={signOutAction}>
          <button className="text-sm text-blue-600 underline">Sign out</button>
        </form>
      </div>

      {locked && (
        <p className="mb-6 rounded bg-yellow-100 px-3 py-2 text-sm text-yellow-800">
          Submissions are locked. Entries are read-only.
        </p>
      )}

      <section className="mb-10 flex flex-col gap-6">
        <h2 className="text-xl font-semibold">School Paper</h2>
        <SchoolPaperForm
          language="english"
          existing={(papers?.find((p) => p.language === "english") as unknown as ExistingPaper) ?? null}
          locked={locked}
        />
        <SchoolPaperForm
          language="filipino"
          existing={(papers?.find((p) => p.language === "filipino") as unknown as ExistingPaper) ?? null}
          locked={locked}
        />
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Event Entries</h2>
        <EntryList entries={(entries as unknown as Entry[]) ?? []} events={events ?? []} locked={locked} />
      </section>
    </main>
  );
}
