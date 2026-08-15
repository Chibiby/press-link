import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";
import { EntryDashboard } from "./EntryDashboard";
import type {
  EntryRow,
  RosterCoach,
  RosterParticipant,
  SchoolPaperRow,
} from "./types";
import { paperFlowState, type PaperParticipation } from "@/lib/paper/gate";
import { paperStatus } from "@/lib/paper/status";
import type { EventRow, EventTypeRow } from "./wizard-steps";
import { formatParticipantNumber, type UsageMap } from "@/lib/roster/limits";
import type { EventCategory } from "@/lib/events-catalog";
import { DashboardHeader } from "@/components/dashboard-header";

/** Formatted server-side so the client never re-derives a locale string. */
const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface RawParticipant {
  id: string;
  participant_number: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
}

interface RawEntry {
  id: string;
  event_id: string;
  submitted_at: string;
  events: {
    name: string;
    category: EventCategory;
    level: EntryRow["level"];
    language: EntryRow["language"];
    event_type_id: string;
  } | null;
  entry_participants: { participants: RawParticipant | null }[];
  entry_coaches: { coaches: RosterCoach | null }[];
}

/** "Dela Cruz, Ana M." — surname first, the way the division office lists people. */
function toRosterParticipant(row: RawParticipant): RosterParticipant {
  const given = [row.first_name, row.middle_name].filter(Boolean).join(" ");
  return {
    id: row.id,
    participant_number: row.participant_number,
    number_label: formatParticipantNumber(row.participant_number),
    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,
    gender: row.gender,
    full_name: [row.last_name, given].filter(Boolean).join(", "),
  };
}

export default async function EntryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: school, error: schoolError } = await supabase
    .from("schools")
    .select("id, name, paper_participation, submission_locked_at, districts(name)")
    .eq("auth_user_id", user.id)
    .single<{
      id: string;
      name: string;
      paper_participation: PaperParticipation;
      submission_locked_at: string | null;
      districts: { name: string } | null;
    }>();

  // A broken query and a signed-in user who owns no school are different
  // problems. Redirecting on both turns any schema drift into what looks like
  // a rejected password — the school is bounced to /login with nothing to see.
  // PGRST116 is "no rows", the only case that genuinely belongs at /login.
  if (schoolError && schoolError.code !== "PGRST116") {
    console.error("EntryPage school lookup", schoolError);
    throw new Error(`Could not load your school: ${schoolError.message}`);
  }

  if (!school) {
    redirect("/login");
  }

  const [
    { data: papers },
    { data: types },
    { data: events },
    { data: rawParticipants },
    { data: rawCoaches },
    { data: rawEntries },
  ] = await Promise.all([
    supabase
      .from("school_papers")
      .select(
        "id, language, updated_at, paper_name, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title)"
      )
      .eq("school_id", school.id)
      .overrideTypes<SchoolPaperRow[]>(),
    supabase
      .from("event_types")
      .select("id, slug, category, name_en, name_fil, min_participants, max_participants, sort_order")
      .order("sort_order")
      .overrideTypes<EventTypeRow[]>(),
    supabase
      .from("events")
      .select("id, event_type_id, category, level, language, name, sort_order")
      .order("sort_order")
      .overrideTypes<EventRow[]>(),
    supabase
      .from("participants")
      .select("id, participant_number, first_name, middle_name, last_name, gender")
      .eq("school_id", school.id)
      .order("participant_number")
      .overrideTypes<RawParticipant[]>(),
    supabase
      .from("coaches")
      .select("id, full_name, gender")
      .eq("school_id", school.id)
      .order("full_name")
      .overrideTypes<RosterCoach[]>(),
    supabase
      .from("entries")
      .select(
        "id, event_id, submitted_at, events(name, category, level, language, event_type_id), entry_participants(participants(id, participant_number, first_name, middle_name, last_name, gender)), entry_coaches(coaches(id, full_name, gender))"
      )
      .eq("school_id", school.id)
      .order("submitted_at", { ascending: false })
      .overrideTypes<RawEntry[]>(),
  ]);

  const entries: EntryRow[] = (rawEntries ?? []).map((row) => ({
    id: row.id,
    event_id: row.event_id,
    submitted_at: row.submitted_at,
    submitted_label: row.submitted_at
      ? DATE_FORMAT.format(new Date(row.submitted_at))
      : "—",
    event_type_id: row.events?.event_type_id ?? "",
    event_name: row.events?.name ?? "Unknown event",
    category: row.events?.category ?? "individual",
    level: row.events?.level ?? "elementary",
    language: row.events?.language ?? "english",
    participants: row.entry_participants
      .map((link) => link.participants)
      .filter((p): p is RawParticipant => p !== null)
      .map(toRosterParticipant),
    coaches: row.entry_coaches
      .map((link) => link.coaches)
      .filter((c): c is RosterCoach => c !== null),
  }));

  // How many entries each participant already sits in, so the wizard can grey
  // out anyone at their cap without a second round trip.
  const usage: UsageMap = {};
  for (const entry of entries) {
    for (const participant of entry.participants) {
      const current = usage[participant.id] ?? { individualCount: 0, groupCount: 0 };
      if (entry.category === "individual") current.individualCount += 1;
      else current.groupCount += 1;
      usage[participant.id] = current;
    }
  }

  // One place decides where the school is in the paper flow, and therefore
  // whether the form is forced open, locked, or done — see lib/paper/gate.ts.
  const paperFlow = paperFlowState({
    participation: school.paper_participation,
    savedLanguages: (papers ?? []).map((p) => p.language),
    lockedAt: school.submission_locked_at,
    entryCount: entries.length,
  });

  const status = paperStatus({
    participation: school.paper_participation,
    paperCount: (papers ?? []).length,
    lockedAt: school.submission_locked_at,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title={school.name}
        subtitle={school.districts?.name}
        badge={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
        signOutAction={signOutAction}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <EntryDashboard
          entries={entries}
          types={types ?? []}
          events={events ?? []}
          papers={papers ?? []}
          participants={(rawParticipants ?? []).map(toRosterParticipant)}
          coaches={rawCoaches ?? []}
          usage={usage}
          paperFlow={paperFlow}
          paperStatus={status}
          participation={school.paper_participation}
        />
      </main>
    </div>
  );
}
