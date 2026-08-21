"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  paperParticipationSchema,
  rosterCoachSchema,
  rosterParticipantSchema,
} from "@/lib/validation/roster";
import { paperFlowState, type PaperParticipation } from "@/lib/paper/gate";
import type { PaperLevel } from "@/lib/paper/level";
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

/**
 * The roster stays shut until the school paper business is settled. The dialogs
 * enforce this too, but a hand-rolled request would sail past them.
 */
async function assertPaperSettled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  schoolId: string
): Promise<string | null> {
  const [{ data: school }, { data: papers }, { count: entryCount }] = await Promise.all([
    supabase
      .from("schools")
      .select("paper_participation, submission_locked_at, is_integrated")
      .eq("id", schoolId)
      .single<{
        paper_participation: PaperParticipation;
        submission_locked_at: string | null;
        is_integrated: boolean;
      }>(),
    supabase
      .from("school_papers")
      .select("language, level")
      .eq("school_id", schoolId)
      .overrideTypes<{ language: EventLanguage; level: PaperLevel }[]>(),
    supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId),
  ]);
  if (!school) return "School not found.";

  const state = paperFlowState({
    participation: school.paper_participation,
    savedPapers: papers ?? [],
    isIntegrated: school.is_integrated ?? false,
    lockedAt: school.submission_locked_at,
    entryCount: entryCount ?? 0,
  });
  return state.rosterEnabled
    ? null
    : "Finish your School Paper before adding people.";
}

/**
 * A locked submission is read-only. The triggers refuse these writes anyway;
 * this turns the refusal into a sentence the school can act on.
 */
async function assertUnlocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  schoolId: string
): Promise<string | null> {
  const { data: school } = await supabase
    .from("schools")
    .select("submission_locked_at")
    .eq("id", schoolId)
    .single<{ submission_locked_at: string | null }>();
  if (!school) return "School not found.";
  return school.submission_locked_at !== null
    ? "Your submission is locked. Ask the division office to reopen it."
    : null;
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
  const locked = await assertUnlocked(supabase, schoolId);
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
  const locked = await assertUnlocked(supabase, schoolId);
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
  const locked = await assertUnlocked(supabase, schoolId);
  if (locked) return { error: locked };
  const unsettled = await assertPaperSettled(supabase, schoolId);
  if (unsettled) return { error: unsettled };

  const { error } = await supabase.from("coaches").insert({
    school_id: schoolId,
    first_name: parsed.data.firstName,
    middle_name: parsed.data.middleName || null,
    last_name: parsed.data.lastName,
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
  const locked = await assertUnlocked(supabase, schoolId);
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

/**
 * The paper RPCs raise their own exceptions, and a stale tab hits them for
 * reasons the school can act on — another tab locked the details, or the form
 * was never saved. Postgres hands those back as one opaque failure, so match
 * the sentences we raised and keep the generic line for anything else.
 */
function rpcMessage(error: { message?: string }, fallback: string): string {
  const raised = error.message ?? "";
  if (raised.includes("submission is locked")) {
    return "Your submission is locked. Ask the division office to reopen it.";
  }
  if (raised.includes("save your school paper information first")) {
    return "Save your school paper information first.";
  }
  if (raised.includes("answer the school paper contest question first")) {
    return "Answer the school paper contest question first.";
  }
  if (raised.includes("create at least one entry first")) {
    return "Create at least one entry before locking your submission.";
  }
  return fallback;
}

export async function setPaperParticipationAction(
  choice: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = paperParticipationSchema.safeParse(choice);
  if (!parsed.success) return { error: "Please answer Yes or No." };

  const supabase = await createClient();
  // Definer RPC: a school may write this answer and nothing else on its row.
  // It also refuses unless at least one language is on file, so the roster
  // cannot be unlocked by calling this before the form has been filled.
  const { error } = await supabase.rpc("set_paper_participation", {
    choice: parsed.data,
  });
  if (error) {
    console.error("setPaperParticipationAction", error);
    return { error: rpcMessage(error, "Could not save your answer.") };
  }

  revalidatePath("/entry");
  return { success: true as const };
}

export async function lockSubmissionAction(): Promise<
  { error: string } | { success: true }
> {
  const supabase = await createClient();
  // Definer RPC: it refuses a school that has not answered the contest question
  // or has no entries, and stamps the lock only once, so a double click is
  // harmless.
  const { error } = await supabase.rpc("lock_submission");
  if (error) {
    console.error("lockSubmissionAction", error);
    return { error: rpcMessage(error, "Could not lock your submission.") };
  }

  revalidatePath("/entry");
  return { success: true as const };
}
