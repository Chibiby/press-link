"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import { formatParticipantNumber, type UsageMap } from "@/lib/roster/limits";
import { surnameFirst } from "@/lib/roster/names";
import type { MoveEventOption } from "@/lib/roster/participant-move";
import { rosterCoachSchema, rosterParticipantSchema } from "@/lib/validation/roster";

/**
 * The division office writing into a school's own workspace.
 *
 * Three writes and one read, for the school that never got its people onto the
 * roster at all — the one that missed the deadline, lost its login, or sent the
 * list on paper. Reopening that school is the right tool when it can still do the
 * work itself, and no use whatever when it cannot.
 *
 * None of these is the authorisation boundary. `admin_add_participant`,
 * `admin_add_coach` and `admin_create_entry` (migration 0038) each re-check the
 * caller, the school and every rule they enforce. What these add is the sentence a
 * toast can carry, and the shape the dialogs need.
 */

function notAdmin(reason: "unauthenticated" | "not-admin", verb: string): { error: string } {
  return {
    error: reason === "unauthenticated" ? "Not authenticated." : `You are not authorized to ${verb}.`,
  };
}

/**
 * Every surface that reads a school's roster or its entries.
 *
 * `/entry` is included because this is the school's own workspace: the next time
 * they sign in, the learner an officer typed in has to be there.
 */
function revalidateSchool() {
  revalidatePath("/admin/schools");
  revalidatePath("/admin/participants");
  revalidatePath("/admin/coaches");
  revalidatePath("/admin/entries");
  revalidatePath("/entry");
}

export interface SchoolRosterPerson {
  id: string;
  name: string;
  /** Only a participant carries one; a coach has no division number. */
  numberLabel?: string;
}

export interface SchoolRosterDetail {
  schoolName: string;
  participants: SchoolRosterPerson[];
  coaches: SchoolRosterPerson[];
  events: MoveEventOption[];
  /** Events this school has already filed, which it may not file twice. */
  filedEventIds: string[];
  /**
   * How many entries of each category each participant already holds, keyed by
   * participant id — the same shape the school's own wizard builds, so the caps
   * are read by the same function on both sides.
   */
  usage: UsageMap;
}

interface RawEventOption {
  id: string;
  name: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  event_types: { min_participants: number; max_participants: number | null } | null;
}

/**
 * One school's roster, its entries and the catalog, read when a dialog opens.
 *
 * Loaded on demand for the same reason the participants menu does it: the schools
 * table is 332 rows and joining every one of them to its learners and coaches would
 * multiply that read to answer a question about the row somebody clicked.
 */
export async function loadSchoolRosterAction(
  schoolId: string
): Promise<{ error: string } | { detail: SchoolRosterDetail }> {
  const check = await checkAdmin();
  if (!check.isAdmin) return notAdmin(check.reason, "read a school's roster");
  const supabase = check.supabase;

  const [{ data: school }, { data: participants }, { data: coaches }, { data: events }, { data: entries }] =
    await Promise.all([
      supabase.from("schools").select("name").eq("id", schoolId).maybeSingle<{ name: string }>(),
      supabase
        .from("participants")
        .select("id, participant_number, first_name, middle_name, last_name")
        .eq("school_id", schoolId)
        .order("participant_number")
        .overrideTypes<
          {
            id: string;
            participant_number: number;
            first_name: string;
            middle_name: string | null;
            last_name: string;
          }[]
        >(),
      supabase
        .from("coaches")
        .select("id, first_name, middle_name, last_name")
        .eq("school_id", schoolId)
        .order("last_name")
        .overrideTypes<
          { id: string; first_name: string; middle_name: string | null; last_name: string }[]
        >(),
      supabase
        .from("events")
        .select("id, name, category, level, language, event_types(min_participants, max_participants)")
        .order("sort_order")
        .overrideTypes<RawEventOption[]>(),
      supabase.from("entries").select("id, event_id").eq("school_id", schoolId),
    ]);

  if (!school) return { error: "That school could not be found." };

  // The caps, counted per learner over every entry they hold anywhere. Read here
  // rather than in the dialog so a capped contestant is greyed out before they are
  // picked, instead of after the whole form is refused.
  const { data: usageRows } = await supabase
    .from("entry_participants")
    .select("participant_id, entries(events(category))")
    .in("participant_id", (participants ?? []).map((p) => p.id))
    .overrideTypes<
      { participant_id: string; entries: { events: { category: EventCategory } | null } | null }[]
    >();

  const usage: UsageMap = {};
  for (const row of usageRows ?? []) {
    const category = row.entries?.events?.category;
    if (!category) continue;
    const current = usage[row.participant_id] ?? { individualCount: 0, groupCount: 0 };
    if (category === "individual") current.individualCount += 1;
    else current.groupCount += 1;
    usage[row.participant_id] = current;
  }

  return {
    detail: {
      schoolName: school.name,
      participants: (participants ?? []).map((person) => ({
        id: person.id,
        name: surnameFirst(person),
        numberLabel: formatParticipantNumber(person.participant_number),
      })),
      coaches: (coaches ?? []).map((person) => ({ id: person.id, name: surnameFirst(person) })),
      events: (events ?? []).map((event) => ({
        id: event.id,
        name: event.name,
        category: event.category,
        level: event.level,
        language: event.language,
        // 1 and null when the catalog row cannot be read: a minimum of 1 offers the
        // contest rather than hiding it, and an absent maximum never calls an entry
        // full. Both fail toward the RPC, which checks the real numbers.
        minParticipants: event.event_types?.min_participants ?? 1,
        maxParticipants: event.event_types?.max_participants ?? null,
      })),
      filedEventIds: (entries ?? []).map((row) => row.event_id as string),
      usage,
    },
  };
}

export async function addSchoolParticipantAction(
  schoolId: string,
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = rosterParticipantSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }

  const check = await checkAdmin();
  if (!check.isAdmin) return notAdmin(check.reason, "add a learner to a school's roster");

  const { error } = await check.supabase.rpc("admin_add_participant", {
    p_school_id: schoolId,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_gender: parsed.data.gender,
    p_middle_name: parsed.data.middleName || null,
  });

  if (error) {
    console.error("addSchoolParticipantAction", error);
    return { error: `That learner was not added: ${error.message}` };
  }

  revalidateSchool();
  return { success: true as const };
}

export async function addSchoolCoachAction(
  schoolId: string,
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = rosterCoachSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }

  const check = await checkAdmin();
  if (!check.isAdmin) return notAdmin(check.reason, "add a coach to a school's roster");

  const { error } = await check.supabase.rpc("admin_add_coach", {
    p_school_id: schoolId,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_gender: parsed.data.gender,
    p_middle_name: parsed.data.middleName || null,
  });

  if (error) {
    console.error("addSchoolCoachAction", error);
    return { error: `That coach was not added: ${error.message}` };
  }

  revalidateSchool();
  return { success: true as const };
}

/**
 * File one complete entry for a school.
 *
 * The payload is the school's own: contestants, and coaches carrying the contestant
 * each is for. `admin_create_entry` checks all of it again — the minimum, the
 * maximum, the caps, and 0019's one-coach-per-contestant pairing — because an entry
 * that satisfies none of the school's rules is worse than no entry at all: it is one
 * their form will refuse to edit, for a reason nobody typed.
 */
export async function createSchoolEntryAction(input: {
  schoolId: string;
  eventId: string;
  participantIds: string[];
  coaches: { coachId: string; participantId: string | null }[];
}): Promise<{ error: string } | { success: true; contestants: number }> {
  const check = await checkAdmin();
  if (!check.isAdmin) return notAdmin(check.reason, "file an entry for a school");

  const { data, error } = await check.supabase.rpc("admin_create_entry", {
    p_school_id: input.schoolId,
    p_event_id: input.eventId,
    p_participants: input.participantIds,
    p_coaches: input.coaches,
  });

  if (error) {
    console.error("createSchoolEntryAction", error);
    return { error: `That entry was not filed: ${error.message}` };
  }

  revalidateSchool();
  // The judging surfaces read the field an event is ranked over, and this changes it.
  revalidatePath("/admin/judges");
  revalidatePath("/admin/tabulators");

  const result = (data ?? {}) as { contestants?: number };
  return { success: true as const, contestants: result.contestants ?? input.participantIds.length };
}
