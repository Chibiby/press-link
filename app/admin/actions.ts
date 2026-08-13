"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setSubmissionsLockedAction(locked: boolean): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ submissions_locked: locked }).eq("id", true);
  if (error) {
    return { error: "Could not update lock state." };
  }
  revalidatePath("/admin");
  revalidatePath("/entry");
  return { success: true as const };
}

export async function adminSignOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
