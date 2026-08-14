"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  paperParticipationSchema,
  rosterCoachSchema,
  rosterParticipantSchema,
} from "@/lib/validation/roster";
import { paperFlowState, type PaperParticipation } from "@/lib/paper/gate";
import type { EventLanguage } from "@/lib/events-catalog";

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

/**
 * The roster stays shut until the school paper business is settled. The dialogs
 * enforce this too, but a hand-rolled request would sail past them.
 */
async function assertPaperSettled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  schoolId: string
): Promise<string | null> {
  const [{ data: school }, { data: papers }] = await Promise.all([
    supabase
      .from("schools")
      .select("paper_participation")
      .eq("id", schoolId)
      .single<{ paper_participation: PaperParticipation }>(),
    supabase
      .from("school_papers")
      .select("language")
      .eq("school_id", schoolId)
      .overrideTypes<{ language: EventLanguage }[]>(),
  ]);
  if (!school) return "School not found.";

  const state = paperFlowState({
    participation: school.paper_participation,
    savedLanguages: (papers ?? []).map((p) => p.language),
  });
  return state.rosterEnabled
    ? null
    : "Submit your School Paper entry before adding people.";
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
  const unsettled = await assertPaperSettled(supabase, schoolId);
  if (unsettled) return { error: unsettled };

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
  const unsettled = await assertPaperSettled(supabase, schoolId);
  if (unsettled) return { error: unsettled };

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
  choice: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = paperParticipationSchema.safeParse(choice);
  if (!parsed.success) return { error: "Please answer Yes or No." };

  const supabase = await createClient();
  // Definer RPC: a school may write this answer and nothing else on its row.
  // It also refuses unless both papers exist, so the roster cannot be unlocked
  // by calling this before the form has been filled.
  const { error } = await supabase.rpc("set_paper_participation", {
    choice: parsed.data,
  });
  if (error) {
    console.error("setPaperParticipationAction", error);
    return { error: "Could not save your answer." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}
