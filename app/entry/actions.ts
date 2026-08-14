"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { schoolPaperSchema } from "@/lib/validation/school-paper";
import { entrySchema } from "@/lib/validation/entry";
import { capReason, validateEntryCounts, type UsageMap } from "@/lib/roster/limits";

const DUPLICATE_EVENT_MESSAGE = "Your school already has an entry for this event.";

/**
 * The check above loses to a second tab that inserts between the read and the
 * write; `entries_school_event_unique` catches that, and this turns the raw
 * Postgres violation into the same sentence the school would have seen.
 */
function isDuplicateEventViolation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23505" && (error.message ?? "").includes("entries_school_event_unique");
}

async function getSchoolId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: school } = await supabase
    .from("schools")
    .select("id, paper_participation")
    .eq("auth_user_id", user.id)
    .single();
  if (!school) throw new Error("School not found");

  return {
    supabase,
    schoolId: school.id as string,
    paperParticipation: school.paper_participation as "undecided" | "yes" | "no",
  };
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
  const { supabase, schoolId, paperParticipation } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }
  if (paperParticipation === "no") {
    return { error: "Your school is not submitting a school paper." };
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
    console.error("saveSchoolPaperAction", upsertError);
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
    console.error("saveSchoolPaperAction", staffError);
    return { error: "Could not save section heads." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}

export async function saveEntryAction(
  entryId: string | null,
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }

  const { participantIds, coachIds, eventId } = parsed.data;

  // Counts come from the database, never from the client.
  const { data: event } = await supabase
    .from("events")
    .select("id, category, event_types(min_participants, max_participants)")
    .eq("id", eventId)
    .single<{
      id: string;
      category: "individual" | "group";
      event_types: { min_participants: number; max_participants: number | null } | null;
    }>();
  if (!event || !event.event_types) return { error: "Unknown event." };

  // One entry per event, per school. `events` rows are unique per contest,
  // level and language, so this also covers "per language".
  const { data: existingForEvent, error: existingForEventError } = await supabase
    .from("entries")
    .select("id")
    .eq("school_id", schoolId)
    .eq("event_id", eventId);
  if (existingForEventError) {
    console.error("saveEntryAction", existingForEventError);
    return { error: "Could not check your existing entries." };
  }
  if ((existingForEvent ?? []).some((row) => row.id !== entryId)) {
    return { error: DUPLICATE_EVENT_MESSAGE };
  }

  const countError = validateEntryCounts({
    category: event.category,
    participantIds,
    coachIds,
    minParticipants: event.event_types.min_participants,
    maxParticipants: event.event_types.max_participants,
  });
  if (countError) return { error: countError };

  // Everyone referenced must belong to this school.
  const [{ data: ownedParticipants }, { data: ownedCoaches }] = await Promise.all([
    supabase.from("participants").select("id").eq("school_id", schoolId).in("id", participantIds),
    supabase.from("coaches").select("id").eq("school_id", schoolId).in("id", coachIds),
  ]);
  if ((ownedParticipants?.length ?? 0) !== participantIds.length) {
    return { error: "One of those participants is not on your roster." };
  }
  if ((ownedCoaches?.length ?? 0) !== coachIds.length) {
    return { error: "One of those coaches is not on your roster." };
  }

  // Participation caps, counted over every entry except the one being edited.
  const { data: usageRows } = await supabase
    .from("entry_participants")
    .select("participant_id, entry_id, entries(event_id, events(category))")
    .in("participant_id", participantIds)
    .overrideTypes<
      {
        participant_id: string;
        entry_id: string;
        entries: { event_id: string; events: { category: "individual" | "group" } | null } | null;
      }[]
    >();

  const usage: UsageMap = {};
  for (const row of usageRows ?? []) {
    if (entryId && row.entry_id === entryId) continue;
    const category = row.entries?.events?.category;
    if (!category) continue;
    const current = usage[row.participant_id] ?? { individualCount: 0, groupCount: 0 };
    if (category === "individual") current.individualCount += 1;
    else current.groupCount += 1;
    usage[row.participant_id] = current;
  }

  for (const participantId of participantIds) {
    const reason = capReason(usage[participantId], event.category);
    if (reason) {
      return { error: `A selected participant is unavailable: ${reason.toLowerCase()}.` };
    }
  }

  let id = entryId;
  if (id) {
    // supabase-js cannot express a multi-statement transaction, so the
    // delete-then-insert below is a compensating write: snapshot the current
    // members first, and if either insert fails afterward, restore them so a
    // previously valid entry never ends up silently emptied.
    const [{ data: participantSnapshot, error: participantSnapshotError }, { data: coachSnapshot, error: coachSnapshotError }] =
      await Promise.all([
        supabase.from("entry_participants").select("participant_id").eq("entry_id", id),
        supabase.from("entry_coaches").select("coach_id").eq("entry_id", id),
      ]);
    if (participantSnapshotError || coachSnapshotError) {
      console.error("saveEntryAction", participantSnapshotError ?? coachSnapshotError);
      return { error: "Could not read the existing entry." };
    }

    const { error: deleteParticipantsError } = await supabase
      .from("entry_participants")
      .delete()
      .eq("entry_id", id);
    if (deleteParticipantsError) {
      console.error("saveEntryAction", deleteParticipantsError);
      return { error: "Could not update entry." };
    }

    const { error: deleteCoachesError } = await supabase
      .from("entry_coaches")
      .delete()
      .eq("entry_id", id);
    if (deleteCoachesError) {
      console.error("saveEntryAction", deleteCoachesError);
      return { error: "Could not update entry." };
    }

    // Restores both tables to the pre-mutation snapshot. Called after a
    // failed insert, so any rows this attempt already wrote for that table
    // must be cleared first or the restore would duplicate them. Reports
    // whether the restore itself succeeded rather than swallowing its own
    // errors — a restore that fails is surfaced to the caller, not treated
    // as a clean no-op, so the school is told when the entry needs a
    // manual check instead of being reassured nothing changed.
    const restoreSnapshot = async (): Promise<boolean> => {
      const previousParticipantIds = (participantSnapshot ?? []).map((row) => row.participant_id as string);
      const previousCoachIds = (coachSnapshot ?? []).map((row) => row.coach_id as string);

      const { error: restoreDeleteParticipantsError } = await supabase
        .from("entry_participants")
        .delete()
        .eq("entry_id", id);
      const { error: restoreDeleteCoachesError } = await supabase
        .from("entry_coaches")
        .delete()
        .eq("entry_id", id);
      if (restoreDeleteParticipantsError || restoreDeleteCoachesError) {
        console.error(
          "saveEntryAction.restoreSnapshot",
          restoreDeleteParticipantsError ?? restoreDeleteCoachesError
        );
        return false;
      }

      if (previousParticipantIds.length) {
        const { error: restoreParticipantsError } = await supabase
          .from("entry_participants")
          .insert(previousParticipantIds.map((participantId) => ({ entry_id: id, participant_id: participantId })));
        if (restoreParticipantsError) {
          console.error("saveEntryAction.restoreSnapshot", restoreParticipantsError);
          return false;
        }
      }
      if (previousCoachIds.length) {
        const { error: restoreCoachesError } = await supabase
          .from("entry_coaches")
          .insert(previousCoachIds.map((coachId) => ({ entry_id: id, coach_id: coachId })));
        if (restoreCoachesError) {
          console.error("saveEntryAction.restoreSnapshot", restoreCoachesError);
          return false;
        }
      }
      return true;
    };

    const RESTORE_FAILED_MESSAGE =
      "Could not save the entry, and its previous participants and coaches could not be restored. Please re-open this entry and check its members.";

    const { error: participantsError } = await supabase
      .from("entry_participants")
      .insert(participantIds.map((participantId) => ({ entry_id: id, participant_id: participantId })));
    if (participantsError) {
      console.error("saveEntryAction", participantsError);
      const restored = await restoreSnapshot();
      return { error: restored ? "Could not save participants." : RESTORE_FAILED_MESSAGE };
    }

    const { error: coachesError } = await supabase
      .from("entry_coaches")
      .insert(coachIds.map((coachId) => ({ entry_id: id, coach_id: coachId })));
    if (coachesError) {
      console.error("saveEntryAction", coachesError);
      const restored = await restoreSnapshot();
      return { error: restored ? "Could not save coaches." : RESTORE_FAILED_MESSAGE };
    }

    // Only flip the entry onto the new event once both member inserts have
    // succeeded, so a failed insert (restored above) never leaves the row
    // pointing at an event its membership no longer satisfies.
    const { error: updateError } = await supabase
      .from("entries")
      .update({ event_id: eventId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId);
    if (updateError) {
      console.error("saveEntryAction", updateError);
      return {
        error: isDuplicateEventViolation(updateError)
          ? DUPLICATE_EVENT_MESSAGE
          : "Could not update entry.",
      };
    }

    revalidatePath("/entry");
    return { success: true as const };
  } else {
    const { data: inserted, error } = await supabase
      .from("entries")
      .insert({ event_id: eventId, school_id: schoolId })
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("saveEntryAction", error);
      return {
        error: isDuplicateEventViolation(error)
          ? DUPLICATE_EVENT_MESSAGE
          : "Could not create entry.",
      };
    }
    id = inserted.id;
  }

  const { error: participantsError } = await supabase
    .from("entry_participants")
    .insert(participantIds.map((participantId) => ({ entry_id: id, participant_id: participantId })));
  if (participantsError) {
    console.error("saveEntryAction", participantsError);
    return { error: "Could not save participants." };
  }

  const { error: coachesError } = await supabase
    .from("entry_coaches")
    .insert(coachIds.map((coachId) => ({ entry_id: id, coach_id: coachId })));
  if (coachesError) {
    console.error("saveEntryAction", coachesError);
    return { error: "Could not save coaches." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}

export async function deleteEntryAction(entryId: string): Promise<{ error: string } | { success: true }> {
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }
  const { error } = await supabase.from("entries").delete().eq("id", entryId).eq("school_id", schoolId);
  if (error) {
    console.error("deleteEntryAction", error);
    return { error: "Could not delete entry." };
  }
  revalidatePath("/entry");
  return { success: true as const };
}
