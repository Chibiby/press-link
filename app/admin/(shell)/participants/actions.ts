"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirst } from "@/lib/roster/names";
import type {
  MoveEventOption,
  ParticipantEntrySummary,
} from "@/lib/roster/participant-move";

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

/**
 * One participant's entries, coaches and the contests they could be moved into.
 *
 * Loaded on demand when the row's menu is opened, not with the table. The roster is
 * 2,273 learners and the page already pages through every one of them; joining each
 * to its entries, teammates, coaches and the catalog would multiply that read to
 * answer a question about the single row somebody clicked. One participant is one
 * small query, and it is only ever issued for a menu that was actually opened.
 */
export interface ParticipantDetail {
  fullName: string;
  numberLabel: string;
  gender: "M" | "F";
  schoolName: string;
  districtName: string;
  entries: ParticipantEntrySummary[];
  /** The whole catalog, in the order the events matrix lists it. */
  events: MoveEventOption[];
  /** Events this school already has an entry in — not only this participant's. */
  schoolEventIds: string[];
  /** Events a judge has ranked in, so a move can say what it will cost. */
  judgedEventIds: string[];
}

interface RawDetailEntry {
  entry_id: string;
  entries: {
    id: string;
    event_id: string;
    events: {
      name: string;
      category: EventCategory;
      level: EventLevel;
      language: EventLanguage;
      event_types: { min_participants: number } | null;
    } | null;
    entry_participants: {
      participants: { id: string; first_name: string; middle_name: string | null; last_name: string } | null;
    }[];
    entry_coaches: {
      coaches: { first_name: string; middle_name: string | null; last_name: string } | null;
    }[];
  } | null;
}

export async function loadParticipantDetailAction(
  participantId: string
): Promise<{ error: string } | { detail: ParticipantDetail }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to read a participant's entries.",
    };
  }
  const supabase = check.supabase;

  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .select(
      "id, participant_number, first_name, middle_name, last_name, gender, school_id, schools(name, districts(name))"
    )
    .eq("id", participantId)
    .maybeSingle<{
      id: string;
      participant_number: number;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      gender: "M" | "F";
      school_id: string;
      schools: { name: string; districts: { name: string } | null } | null;
    }>();

  if (participantError) {
    console.error("loadParticipantDetailAction participant", participantError);
    return { error: "Could not read that participant." };
  }
  if (!participant) return { error: "That participant could not be found." };

  const [{ data: rawEntries, error: entriesError }, { data: events, error: eventsError }] =
    await Promise.all([
      supabase
        .from("entry_participants")
        .select(
          "entry_id, entries(id, event_id, events(name, category, level, language, event_types(min_participants)), entry_participants(participants(id, first_name, middle_name, last_name)), entry_coaches(coaches(first_name, middle_name, last_name)))"
        )
        .eq("participant_id", participantId)
        .overrideTypes<RawDetailEntry[]>(),
      supabase
        .from("events")
        .select("id, name, category, level, language")
        .order("sort_order")
        .overrideTypes<MoveEventOption[]>(),
    ]);

  if (entriesError || eventsError) {
    console.error("loadParticipantDetailAction entries", entriesError ?? eventsError);
    return { error: "Could not read that participant's entries." };
  }

  // Both are read for the school, not for the participant: whether a destination
  // entry already exists is a fact about the school, and it is what tells the dialog
  // whether this move creates one.
  const [{ data: schoolEntries }, { data: judgedSheets }] = await Promise.all([
    supabase.from("entries").select("event_id").eq("school_id", participant.school_id),
    // Which events have been ranked. A submitted sheet is exactly a sheet with ranks
    // on it — writing a sheet is what submits it (N6) — so this answers the question
    // without joining judge_ranks. One row per judge per round, small enough to read
    // whole, and asking per event would be a query per option in the dropdown.
    supabase.from("judge_sheets").select("event_id").not("submitted_at", "is", null),
  ]);

  const judgedEventIds = [
    ...new Set((judgedSheets ?? []).map((row) => row.event_id as string)),
  ];

  const entries: ParticipantEntrySummary[] = (rawEntries ?? []).flatMap((row) => {
    const entry = row.entries;
    if (!entry || !entry.events) return [];
    return [
      {
        entryId: entry.id,
        eventId: entry.event_id,
        eventName: entry.events.name,
        category: entry.events.category,
        level: entry.events.level,
        language: entry.events.language,
        teammates: (entry.entry_participants ?? [])
          .map((link) => link.participants)
          .filter((person) => person !== null && person.id !== participantId)
          .map((person) => surnameFirst(person!)),
        coachNames: (entry.entry_coaches ?? [])
          .map((link) => link.coaches)
          .filter((coach) => coach !== null)
          .map((coach) => surnameFirst(coach!)),
        // 1 rather than 0 when the catalog row cannot be read: a minimum of nought
        // would let the consequence list say an emptied team is fine.
        minParticipants: entry.events.event_types?.min_participants ?? 1,
        judged: judgedEventIds.includes(entry.event_id),
      },
    ];
  });

  return {
    detail: {
      fullName: surnameFirst(participant),
      numberLabel: formatParticipantNumber(participant.participant_number),
      gender: participant.gender,
      schoolName: participant.schools?.name ?? "",
      districtName: participant.schools?.districts?.name ?? "",
      entries,
      events: events ?? [],
      schoolEventIds: (schoolEntries ?? []).map((row) => row.event_id as string),
      judgedEventIds,
    },
  };
}

/**
 * Move one contestant out of the event a school filed them under and into another.
 *
 * Everything that decides whether this is allowed is in
 * `admin_move_participant_event` (migration 0034) — ownership, the participation
 * caps, the destination's maximum, the source's minimum, and what happens to a rank
 * already cast. This function is not the boundary. What it adds is the sentence:
 * the RPC raises `not authorized` or `... needs at least 7 contestants ...`, and a
 * toast has to carry that to somebody who did not write it.
 *
 * `confirmDiscard` is passed through rather than decided here. The dialog prints
 * what will be discarded and the admin answers; a default of true would make the
 * warning decorative.
 */
export async function moveParticipantEventAction(input: {
  participantId: string;
  fromEntryId: string;
  toEventId: string;
  confirmDiscard: boolean;
}): Promise<{ error: string } | { success: true; notes: string[] }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to move a contestant between events.",
    };
  }

  const { data, error } = await check.supabase.rpc("admin_move_participant_event", {
    p_participant_id: input.participantId,
    p_from_entry_id: input.fromEntryId,
    p_to_event_id: input.toEventId,
    p_discard_ranks: input.confirmDiscard,
  });

  if (error) {
    console.error("moveParticipantEventAction", error);
    return { error: `That contestant was not moved: ${error.message}` };
  }

  const result = (data ?? {}) as {
    destinationEntryCreated?: boolean;
    sourceEntryDeleted?: boolean;
    coachCarried?: boolean;
    ranksDiscarded?: number;
  };

  // What the database did that the admin did not type. Each is reported because each
  // is something they would otherwise find out by noticing it later.
  const notes: string[] = [];
  if (result.destinationEntryCreated) notes.push("A new entry was created for that event.");
  if (result.sourceEntryDeleted) notes.push("The entry they came from is now empty and was deleted.");
  if (result.ranksDiscarded) {
    notes.push(
      `${result.ranksDiscarded} ${result.ranksDiscarded === 1 ? "rank was" : "ranks were"} discarded.`
    );
  }
  if (!result.coachCarried) {
    notes.push("No coach was carried over — the school will need to name one for that entry.");
  }

  // Every surface that reads entries. The judging pages are included because a moved
  // contestant changes the field an event is ranked over.
  revalidatePath("/admin/participants");
  revalidatePath("/admin/entries");
  revalidatePath("/admin/judges");
  revalidatePath("/admin/tabulators");
  revalidatePath("/entry");

  return { success: true as const, notes };
}
