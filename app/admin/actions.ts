"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setSubmissionsLockedAction(locked: boolean): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ submissions_locked: locked }).eq("id", true);
  if (error) {
    return { error: "Could not update lock state." };
  }
  revalidatePath("/admin");
  return { success: true as const };
}
