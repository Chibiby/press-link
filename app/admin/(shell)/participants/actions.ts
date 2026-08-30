"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import { auditAction, auditLogState } from "@/lib/admin/audit-log";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirst } from "@/lib/roster/names";
import type {
  MoveEventOption,
  ParticipantEntrySummary,
  SchoolEntrySummary,
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
  /**
   * This school's coaches, so a move can name the one who takes the contestant in
   * the contest they are moving into. That school's own roster and no other: a
   * coach from elsewhere on an entry would be a worse mistake than the one being
   * corrected, which is why the RPC checks it again.
   */
  coaches: { id: string; name: string }[];
  /**
   * The entries this school already holds, whoever is on them, with how many
   * contestants each carries.
   *
   * The count is what tells a full entry from one with room, which is the only thing
   * that makes a group event assignable at all — see `assignDestinations`.
   */
  schoolEntries: SchoolEntrySummary[];
  /** Events a judge has ranked in, so a move can say what it will cost. */
  judgedEventIds: string[];
}

/**
 * The catalog row as PostgREST returns it, with the limits still nested under the
 * event type. `MoveEventOption` is the flat shape the pure module wants.
 */
interface RawEventOption {
  id: string;
  name: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  event_types: { min_participants: number; max_participants: number | null } | null;
}

/** One `entry_coaches` row as the detail query selects it. */
interface RawCoachLink {
  participant_id: string | null;
  coaches: {
    id: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
  } | null;
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
    entry_coaches: RawCoachLink[];
  } | null;
}

/**
 * The coach an entry pairs with one contestant, or null.
 *
 * `participant_id` on `entry_coaches` is 0019's column and it is what makes the
 * pairing a fact rather than an inference. A group entry leaves it null on every
 * row — the coaches are the team's — so this correctly finds nobody there instead
 * of returning whichever coach the query happened to order first.
 */
function pairedCoach(links: RawCoachLink[], participantId: string): RawCoachLink["coaches"] {
  return (
    (links ?? []).find((link) => link.participant_id === participantId && link.coaches)?.coaches ??
    null
  );
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
          "entry_id, entries(id, event_id, events(name, category, level, language, event_types(min_participants)), entry_participants(participants(id, first_name, middle_name, last_name)), entry_coaches(participant_id, coaches(id, first_name, middle_name, last_name)))"
        )
        .eq("participant_id", participantId)
        .overrideTypes<RawDetailEntry[]>(),
      supabase
        .from("events")
        // The team sizes come with the catalog: they decide which contests one
        // contestant can be entered in at all, and reading them here means the
        // dialog never has to ask a second question to grey an option out.
        .select("id, name, category, level, language, event_types(min_participants, max_participants)")
        .order("sort_order")
        .overrideTypes<RawEventOption[]>(),
    ]);

  if (entriesError || eventsError) {
    console.error("loadParticipantDetailAction entries", entriesError ?? eventsError);
    return { error: "Could not read that participant's entries." };
  }

  // Both are read for the school, not for the participant: whether a destination
  // entry already exists is a fact about the school, and it is what tells the dialog
  // whether this move creates one.
  const [{ data: schoolEntries }, { data: judgedSheets }, { data: schoolCoaches }] =
    await Promise.all([
    supabase
      .from("entries")
      .select("event_id, entry_participants(count)")
      .eq("school_id", participant.school_id)
      .overrideTypes<{ event_id: string; entry_participants: { count: number }[] }[]>(),
    // Which events have been ranked. A submitted sheet is exactly a sheet with ranks
    // on it — writing a sheet is what submits it (N6) — so this answers the question
    // without joining judge_ranks. One row per judge per round, small enough to read
    // whole, and asking per event would be a query per option in the dropdown.
    supabase.from("judge_sheets").select("event_id").not("submitted_at", "is", null),
    supabase
      .from("coaches")
      .select("id, first_name, middle_name, last_name")
      .eq("school_id", participant.school_id)
      .order("last_name")
      .overrideTypes<
        { id: string; first_name: string; middle_name: string | null; last_name: string }[]
      >(),
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
        // The one paired with this contestant, which on an individual entry is the
        // only coach that is theirs. A group entry pairs nobody — its coaches belong
        // to the team — so both stay null there rather than borrowing a team coach
        // and presenting them as this contestant's.
        coachId: pairedCoach(entry.entry_coaches, participantId)?.id ?? null,
        coachName: (() => {
          const paired = pairedCoach(entry.entry_coaches, participantId);
          return paired ? surnameFirst(paired) : null;
        })(),
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
      // `entry_participants(count)` arrives as a one-element array, unwrapped here
      // rather than in the pure module — the same shape the page's own roster query
      // flattens for `school_papers(count)`.
      schoolEntries: (schoolEntries ?? []).map((row) => ({
        eventId: row.event_id,
        memberCount: row.entry_participants?.[0]?.count ?? 0,
      })),
      judgedEventIds,
      coaches: (schoolCoaches ?? []).map((coach) => ({
        id: coach.id,
        name: surnameFirst(coach),
      })),
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
  /** null keeps whoever the source entry paired with this contestant. */
  coachId: string | null;
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
    p_coach_id: input.coachId,
  });

  if (error) {
    console.error("moveParticipantEventAction", error);
    return { error: `That contestant was not moved: ${error.message}` };
  }

  const result = (data ?? {}) as {
    destinationEntryCreated?: boolean;
    sourceEntryDeleted?: boolean;
    coachCarried?: boolean;
    coachChosen?: boolean;
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

/**
 * Enter a contestant in an event on their school's behalf.
 *
 * The sibling of `moveParticipantEventAction`, for the learner who is on the roster
 * and in nothing at all. Everything that decides whether it is allowed lives in
 * `admin_assign_participant_event` (migration 0037) — the participation caps, the
 * entry maximum, the coach's school, and the refusal to start a team of seven with
 * one contestant. This function is not the boundary; it carries the RPC's sentence
 * to somebody who did not write it.
 */
export async function assignParticipantEventAction(input: {
  participantId: string;
  eventId: string;
  /** null enters them with no coach named, which the school can fill in later. */
  coachId: string | null;
}): Promise<{ error: string } | { success: true; notes: string[] }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to enter a contestant in an event.",
    };
  }

  const { data, error } = await check.supabase.rpc("admin_assign_participant_event", {
    p_participant_id: input.participantId,
    p_event_id: input.eventId,
    p_coach_id: input.coachId,
  });

  if (error) {
    console.error("assignParticipantEventAction", error);
    return { error: `That contestant was not entered: ${error.message}` };
  }

  const result = (data ?? {}) as {
    entryCreated?: boolean;
    coachSet?: boolean;
  };

  const notes: string[] = [];
  if (result.entryCreated) notes.push("A new entry was created for that event.");
  if (!result.coachSet) {
    notes.push("No coach was named on that entry — the school will need to add one.");
  }

  revalidatePath("/admin/participants");
  revalidatePath("/admin/entries");
  revalidatePath("/admin/judges");
  revalidatePath("/admin/tabulators");
  revalidatePath("/entry");

  return { success: true as const, notes };
}

/** One line of a contestant's history, already worded and formatted. */
export interface ParticipantHistoryRow {
  id: string;
  /** "23 Aug 2026, 4:12 PM" in Manila — the division's clock, pinned like every other formatter. */
  when: string;
  /** `auditAction`'s phrase for the kind, so this dialog and the audit log agree. */
  action: string;
  /** What the row denormalised at write time: a name, an event, or a move's two events. */
  detail: string | null;
}

const HISTORY_WHEN = new Intl.DateTimeFormat("en-PH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

/**
 * What has been recorded against this contestant, newest first.
 *
 * Read from `activity_events` by `subject_id`, which is the participant's own id on
 * every kind that is about a person — 0025 stamps it on `participant-added` and
 * `participant-removed`, and 0035's move does the same. So this is the contestant's
 * history and not their school's: the entry rows a move also produces are stamped
 * with an *entry* id and belong to `/admin/audit-logs`, which is the surface for
 * reading the division's whole account of itself.
 *
 * The log only reaches back to when it was installed. A contestant registered before
 * migration 0024 has nothing here, and the dialog says so rather than showing an
 * empty list that reads as "nothing ever happened".
 */
export async function loadParticipantHistoryAction(
  participantId: string
): Promise<{ error: string } | { rows: ParticipantHistoryRow[] }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to read the activity log.",
    };
  }

  const { data, error } = await check.supabase
    .from("activity_events")
    // `at desc, id desc`, like the audit page: a single action can stamp several
    // rows in one instant, and an unstable order shuffles them between two reads.
    .select("id, at, kind, label")
    .eq("subject_id", participantId)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100)
    .overrideTypes<{ id: number; at: string; kind: string; label: string | null }[]>();

  if (error) {
    // `auditLogState` tells a missing table from a real failure, and the two need
    // different sentences: one is a log that was never installed, the other is a log
    // that would not answer. Reporting the second as the first is how a broken audit
    // trail looks healthy.
    console.error("loadParticipantHistoryAction", error);
    return {
      error:
        auditLogState(error) === "absent"
          ? "The activity log is not installed on this database, so no history was recorded."
          : "The activity log could not be read.",
    };
  }

  const rows: ParticipantHistoryRow[] = [];
  for (const row of data ?? []) {
    const at = Date.parse(row.at);
    // `at` is not null in the schema, so this is unreachable against a real
    // database — and a row rendering as "Invalid Date" is worse than one dropped.
    if (!Number.isFinite(at)) continue;
    rows.push({
      id: String(row.id),
      when: HISTORY_WHEN.format(at),
      action: auditAction(row.kind),
      detail: (row.label ?? "").trim() || null,
    });
  }

  return { rows };
}
