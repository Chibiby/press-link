"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveSchoolEmail } from "@/lib/auth/resolve-school-email";

export async function loginAction(formData: FormData): Promise<{ error: string } | void> {
  const schoolId = String(formData.get("schoolId") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!schoolId || !password) {
    return { error: "Please select a school and enter the School ID." };
  }

  const supabase = await createClient();

  const { data: school } = await supabase
    .from("schools")
    .select("id, school_id_number")
    .eq("id", schoolId)
    .single();

  if (!school) {
    return { error: "School not found." };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: resolveSchoolEmail(school.school_id_number),
    password,
  });

  if (error) {
    return { error: "Incorrect School ID for the selected school." };
  }

  redirect("/entry");
}
