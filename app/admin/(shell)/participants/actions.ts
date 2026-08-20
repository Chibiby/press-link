"use server";

import { revalidatePath } from "next/cache";
import { checkAdmin } from "@/app/admin/guard";

export async function resetPaperParticipationAction(
  schoolId: string
): Promise<{ error: string } | { success: true }> {
  // The RPC re-checks admin_profiles itself; checking here too means a caller
  // who is signed in but not an admin gets an honest authorization message
  // instead of a generic failure, and never reaches the database.
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to reset a school's answer.",
    };
  }
  const supabase = check.supabase;

  const { error } = await supabase.rpc("admin_reset_paper_participation", {
    target_school: schoolId,
  });
  if (error) {
    console.error("resetPaperParticipationAction", error);
    return { error: "Could not reset that school's answer." };
  }

  revalidatePath("/admin/participants");
  revalidatePath("/entry");
  return { success: true as const };
}
