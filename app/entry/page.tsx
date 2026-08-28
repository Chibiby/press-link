import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { surnameFirst } from "@/lib/roster/names";
import { signOutAction } from "./actions";
import { EntryDashboard } from "./EntryDashboard";
import type {
  EntryRow,
  RosterCoach,
  RosterParticipant,
  ArchivedPaperRow,
  SchoolPaperRow,
} from "./types";
import { paperFlowState, type PaperParticipation } from "@/lib/paper/gate";
import { paperStatus } from "@/lib/paper/status";
import type { EventRow, EventTypeRow } from "./wizard-steps";
import { formatParticipantNumber, type UsageMap } from "@/lib/roster/limits";
import type { EventCategory } from "@/lib/events-catalog";
import { entrySubmissionLock, globalFreezeFromRead } from "@/lib/submissions/school-lock";
import { activeGrant, type RawRevisionGrant } from "@/lib/submissions/revision-grant";
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

interface RawCoach {
  id: string;
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
  entry_coaches: { participant_id: string | null; coaches: RawCoach | null }[];
}

/** "Dela Cruz, Ana M." — surname first, the way the division office lists people. */
function toRosterParticipant(row: RawParticipant): RosterParticipant {
  return {
    id: row.id,
    participant_number: row.participant_number,
    number_label: formatParticipantNumber(row.participant_number),
    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,
    gender: row.gender,
    full_name: surnameFirst(row),
  };
}

function toRosterCoach(row: RawCoach): RosterCoach {
  return { ...row, full_name: surnameFirst(row) };
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
    .select(
      "id, name, paper_participation, submission_locked_at, is_integrated, districts(name)"
    )
    .eq("auth_user_id", user.id)
    .single<{
      id: string;
      name: string;
      paper_participation: PaperParticipation;
      submission_locked_at: string | null;
      /**
       * Whether this school runs elementary and secondary under one id, and so
       * files two papers per language instead of one. Read from the column: it
       * is seeded from the school's name but hand-correctable, and re-deriving
       * it here would throw away a correction the division office made.
       */
      is_integrated: boolean;
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
    { data: archivedPapers },
    { data: types },
    { data: events },
    { data: rawParticipants },
    { data: rawCoaches },
    { data: rawEntries },
    { data: settings, error: settingsError },
    { data: grantRow, error: grantError },
  ] = await Promise.all([
    supabase
      .from("school_papers")
      .select(
        "id, language, level, updated_at, paper_name, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title)"
      )
      .eq("school_id", school.id)
      .overrideTypes<SchoolPaperRow[]>(),
    // Retired by migration 0017 when this school turned out to be integrated.
    // Fetched for every school because the query costs nothing when it matches
    // nothing, and branching on is_integrated here would mean a second round trip
    // for the schools that actually need it.
    supabase
      .from("school_papers_archive")
      .select("id, language, paper_name, adviser_name, principal_name, archived_at, staff")
      .eq("school_id", school.id)
      .order("language")
      .overrideTypes<ArchivedPaperRow[]>(),
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
      .select("id, first_name, middle_name, last_name, gender")
      .eq("school_id", school.id)
      .order("last_name")
      .overrideTypes<RawCoach[]>(),
    supabase
      .from("entries")
      .select(
        "id, event_id, submitted_at, events(name, category, level, language, event_type_id), entry_participants(participants(id, participant_number, first_name, middle_name, last_name, gender)), entry_coaches(participant_id, coaches(id, first_name, middle_name, last_name, gender))"
      )
      .eq("school_id", school.id)
      .order("submitted_at", { ascending: false })
      .overrideTypes<RawEntry[]>(),
    // The division-wide submissions switch from migration 0022. Read here so the
    // school is told about a freeze before it types, instead of after a trigger
    // refuses the save — and read with `maybeSingle`, because a missing row is a
    // state this page has to tell apart from an unlocked flag. What each outcome
    // means, and why a failure is not allowed to break this page, is in
    // `globalFreezeFromRead`.
    supabase
      .from("app_settings")
      .select("submissions_locked")
      .eq("id", true)
      .maybeSingle()
      .overrideTypes<{ submissions_locked: boolean | null }>(),
    // This school's live revision grant from migration 0031, read beside the
    // division-wide switch so a school that was reopened is told so before it
    // goes looking for the buttons that came back.
    //
    // `revoked_at is null` is what "live" means in 0031, and its partial unique
    // index makes at most one row match. The order and the limit are belt and
    // braces for a database where that index is missing: the newest grant is
    // read rather than an arbitrary one. Whether the window is still open is not
    // asked here — `activeGrant()` answers that, once, against one instant, the
    // way `revision_allows()` answers it inside every write.
    supabase
      .from("revision_grants")
      .select("id, expires_at, granted_at, revoked_at, allow_paper, allow_roster, allow_entries")
      .eq("school_id", school.id)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .overrideTypes<RawRevisionGrant>(),
  ]);

  const entries: EntryRow[] = (rawEntries ?? []).map((row) => {
    const category = row.events?.category ?? "individual";
    const coachLinks = row.entry_coaches.filter(
      (link): link is { participant_id: string | null; coaches: RawCoach } =>
        link.coaches !== null
    );

    // One coach may cover several contestants, which is several link rows naming
    // the same person. Every list that reads `coaches` is a list of people, so
    // the repeats are dropped once here instead of in each of them.
    const coachesById = new Map<string, RosterCoach>();
    const coachByParticipant: Record<string, string> = {};
    for (const link of coachLinks) {
      if (!coachesById.has(link.coaches.id)) {
        coachesById.set(link.coaches.id, toRosterCoach(link.coaches));
      }
      if (link.participant_id) coachByParticipant[link.participant_id] = link.coaches.id;
    }

    return {
      id: row.id,
      event_id: row.event_id,
      submitted_at: row.submitted_at,
      submitted_label: row.submitted_at
        ? DATE_FORMAT.format(new Date(row.submitted_at))
        : "—",
      event_type_id: row.events?.event_type_id ?? "",
      event_name: row.events?.name ?? "Unknown event",
      category,
      level: row.events?.level ?? "elementary",
      language: row.events?.language ?? "english",
      participants: row.entry_participants
        .map((link) => link.participants)
        .filter((p): p is RawParticipant => p !== null)
        .map(toRosterParticipant),
      coaches: [...coachesById.values()],
      coachByParticipant,
      // Filed before the pairing existed — migration 0019 back-filled nothing,
      // because guessing which coach belonged to which contestant would put a
      // wrong name against a real contestant.
      coachingPending:
        category === "individual" && coachLinks.some((link) => link.participant_id === null),
    };
  });

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
  // An integrated school has up to two rows per language, so this list repeats
  // a language once per level. That is fine: `paperFlowState` dedupes, and
  // stage 1 has always meant "at least one paper on file for this language",
  // which is still what the school has done when either level is saved.
  const paperFlow = paperFlowState({
    participation: school.paper_participation,
    savedPapers: (papers ?? []).map((p) => ({ language: p.language, level: p.level })),
    isIntegrated: school.is_integrated,
    lockedAt: school.submission_locked_at,
    entryCount: entries.length,
  });

  const status = paperStatus({
    participation: school.paper_participation,
    paperCount: (papers ?? []).length,
    lockedAt: school.submission_locked_at,
  });

  // Logged, not surfaced: the school can do nothing with a PostgREST message, and
  // the ordinary cause is that 0022 has not reached this database yet, which the
  // school must not see as a broken dashboard.
  if (settingsError) console.error("EntryPage submissions lock", settingsError);

  // Logged, then treated as no grant — the same shrug `loadSubmissionsLock` gives
  // an unreadable `app_settings`, for the same reason. The ordinary cause is that
  // 0031 has not reached this database yet and the table is simply not there; RLS
  // and a network blip read identically. Nothing about this read enforces
  // anything, because `revision_allows()` is consulted inside the database on
  // every school-side write and is unaffected either way; all that is at stake is
  // what the school is *told*, and a school told nothing sees exactly the page it
  // saw before this feature existed. Throwing here would take the whole dashboard
  // down without making one write more, or less, permitted.
  if (grantError) console.error("EntryPage revision grant", grantError);

  // One instant for the whole render, and it is the server's. Every judgement about
  // the window is made from it here — a device clock is routinely minutes out, and a
  // browser must never be the thing that decides a window is open while the guard is
  // refusing every write. The banner's countdown is handed this same instant as
  // `serverNow` so that what it displays agrees with the clock `revision_allows()`
  // is actually comparing against; all it is allowed to do at zero is ask the server
  // again.
  const now = new Date();
  const grant = activeGrant(grantError ? null : grantRow, now);

  // One banner, and one read-only decision per surface, for both locks and the
  // grant — see lib/submissions/school-lock.ts for which one wins when they
  // overlap.
  const submissionLock = entrySubmissionLock({
    schoolLocked: paperFlow.submissionLocked,
    global: globalFreezeFromRead({ data: settings, error: settingsError }),
    grant,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title={school.name}
        subtitle={school.districts?.name}
        badge={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
        signOutAction={signOutAction}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 xl:max-w-[90rem]">
        <EntryDashboard
          entries={entries}
          types={types ?? []}
          events={events ?? []}
          papers={papers ?? []}
          archivedPapers={archivedPapers ?? []}
          participants={(rawParticipants ?? []).map(toRosterParticipant)}
          coaches={(rawCoaches ?? []).map(toRosterCoach)}
          usage={usage}
          paperFlow={paperFlow}
          paperStatus={status}
          submissionLock={submissionLock}
          serverNow={now.toISOString()}
          participation={school.paper_participation}
          isIntegrated={school.is_integrated}
        />
      </main>
    </div>
  );
}
