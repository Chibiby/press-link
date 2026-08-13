"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { schoolPaperSchema } from "@/lib/validation/school-paper";
import { entrySchema } from "@/lib/validation/entry";

async function getSchoolId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: school } = await supabase
    .from("schools")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (!school) throw new Error("School not found");

  return { supabase, schoolId: school.id as string };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function saveSchoolPaperAction(
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = schoolPaperSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }

  const { data: paper, error: upsertError } = await supabase
    .from("school_papers")
    .upsert(
      {
        school_id: schoolId,
        language: parsed.data.language,
        paper_name: parsed.data.paperName,
        adviser_name: parsed.data.adviserName,
        adviser_gender: parsed.data.adviserGender,
        principal_name: parsed.data.principalName,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "school_id,language" }
    )
    .select("id")
    .single();

  if (upsertError || !paper) {
    return { error: "Could not save school paper." };
  }

  await supabase.from("paper_staff").delete().eq("school_paper_id", paper.id);
  const { error: staffError } = await supabase.from("paper_staff").insert(
    parsed.data.staff.map((s) => ({
      school_paper_id: paper.id,
      full_name: s.fullName,
      title: s.title,
    }))
  );
  if (staffError) {
    return { error: "Could not save section heads." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}

export async function saveEntryAction(
  entryId: string | null,
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }

  let id = entryId;
  if (id) {
    const { error } = await supabase
      .from("entries")
      .update({ event_id: parsed.data.eventId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId);
    if (error) return { error: "Could not update entry." };
    await supabase.from("entry_participants").delete().eq("entry_id", id);
    await supabase.from("entry_coaches").delete().eq("entry_id", id);
  } else {
    const { data: inserted, error } = await supabase
      .from("entries")
      .insert({ event_id: parsed.data.eventId, school_id: schoolId })
      .select("id")
      .single();
    if (error || !inserted) return { error: "Could not create entry." };
    id = inserted.id;
  }

  const { error: participantsError } = await supabase.from("entry_participants").insert(
    parsed.data.participants.map((p) => ({
      entry_id: id,
      first_name: p.firstName,
      middle_name: p.middleName || null,
      last_name: p.lastName,
      gender: p.gender,
    }))
  );
  if (participantsError) return { error: "Could not save participants." };

  const { error: coachesError } = await supabase.from("entry_coaches").insert(
    parsed.data.coaches.map((c) => ({
      entry_id: id,
      full_name: c.fullName,
      gender: c.gender,
    }))
  );
  if (coachesError) return { error: "Could not save coaches." };

  revalidatePath("/entry");
  return { success: true as const };
}

export async function deleteEntryAction(entryId: string): Promise<{ error: string } | { success: true }> {
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }
  const { error } = await supabase.from("entries").delete().eq("id", entryId).eq("school_id", schoolId);
  if (error) return { error: "Could not delete entry." };
  revalidatePath("/entry");
  return { success: true as const };
}
