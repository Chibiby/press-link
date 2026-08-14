"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  paperAnswerSchema,
  rosterCoachSchema,
  rosterParticipantSchema,
} from "@/lib/validation/roster";

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

async function assertUnlocked(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data: settings } = await supabase
    .from("app_settings")
    .select("submissions_locked")
    .single();
  return settings?.submissions_locked ? "Submissions are locked." : null;
}

export async function addParticipantAction(
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = rosterParticipantSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const locked = await assertUnlocked(supabase);
  if (locked) return { error: locked };

  // participant_number comes from the division-wide sequence default.
  const { error } = await supabase.from("participants").insert({
    school_id: schoolId,
    first_name: parsed.data.firstName,
    middle_name: parsed.data.middleName || null,
    last_name: parsed.data.lastName,
    gender: parsed.data.gender,
  });
  if (error) {
    console.error("addParticipantAction", error);
    return { error: "Could not add participant." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}

export async function deleteParticipantAction(
  participantId: string
): Promise<{ error: string } | { success: true }> {
  const { supabase, schoolId } = await getSchoolId();
  const locked = await assertUnlocked(supabase);
  if (locked) return { error: locked };

  const { count } = await supabase
    .from("entry_participants")
    .select("id", { count: "exact", head: true })
    .eq("participant_id", participantId);
  if (count && count > 0) {
    return { error: "Remove this participant from their entries first." };
  }

  const { error } = await supabase
    .from("participants")
    .delete()
    .eq("id", participantId)
    .eq("school_id", schoolId);
  if (error) {
    console.error("deleteParticipantAction", error);
    return { error: "Could not delete participant." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}

export async function addCoachAction(
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = rosterCoachSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const locked = await assertUnlocked(supabase);
  if (locked) return { error: locked };

  const { error } = await supabase.from("coaches").insert({
    school_id: schoolId,
    full_name: parsed.data.fullName,
    gender: parsed.data.gender,
  });
  if (error) {
    console.error("addCoachAction", error);
    return { error: "Could not add coach." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}

export async function deleteCoachAction(
  coachId: string
): Promise<{ error: string } | { success: true }> {
  const { supabase, schoolId } = await getSchoolId();
  const locked = await assertUnlocked(supabase);
  if (locked) return { error: locked };

  const { count } = await supabase
    .from("entry_coaches")
    .select("id", { count: "exact", head: true })
    .eq("coach_id", coachId);
  if (count && count > 0) {
    return { error: "Remove this coach from their entries first." };
  }

  const { error } = await supabase
    .from("coaches")
    .delete()
    .eq("id", coachId)
    .eq("school_id", schoolId);
  if (error) {
    console.error("deleteCoachAction", error);
    return { error: "Could not delete coach." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}

export async function setPaperParticipationAction(
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = paperAnswerSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Please answer Yes or No." };
  }
  const { choice, reason, note } = parsed.data;

  const supabase = await createClient();
  // Definer RPC: a school may write these columns and nothing else on its row.
  const { error } = await supabase.rpc("set_paper_participation", {
    choice,
    reason: choice === "no" ? (reason ?? null) : null,
    note: reason === "other" ? (note ?? null) : null,
  });
  if (error) {
    console.error("setPaperParticipationAction", error);
    return { error: "Could not save your answer." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}
