"use server";

import { revalidatePath } from "next/cache";
import { checkAdmin } from "../guard";

export async function unlockSubmissionAction(
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
          : "You are not authorized to unlock a school's paper.",
    };
  }
  const supabase = check.supabase;

  const { error } = await supabase.rpc("admin_unlock_submission", {
    target_school: schoolId,
  });
  if (error) {
    console.error("unlockSubmissionAction", error);
    return { error: "Could not unlock that school's submission." };
  }

  revalidatePath("/admin/school-papers");
  revalidatePath("/entry");
  return { success: true as const };
}
