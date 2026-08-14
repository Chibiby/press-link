"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function unlockSchoolPaperAction(
  schoolId: string
): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  // The RPC re-checks admin_profiles itself; this is a route-handler-style
  // guard so a non-admin gets a clean message instead of a raw RPC error.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("admin_unlock_school_paper", {
    target_school: schoolId,
  });
  if (error) {
    console.error("unlockSchoolPaperAction", error);
    return { error: "Could not unlock that school's paper." };
  }

  revalidatePath("/admin/school-papers");
  revalidatePath("/entry");
  return { success: true as const };
}
