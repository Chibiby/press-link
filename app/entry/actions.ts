"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { schoolPaperSchema } from "@/lib/validation/school-paper";

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
