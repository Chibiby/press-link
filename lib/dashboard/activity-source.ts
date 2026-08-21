import {
  joinMeta,
  mergeActivityFeed,
  personLabel,
  type ActivityFeed,
} from "@/lib/dashboard/activity";
import type { PaperParticipation } from "@/lib/paper/gate";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirst } from "@/lib/roster/names";
import type { SupabaseServerClient } from "@/lib/supabase/server";

interface EntryActivityRow {
  id: string;
  submitted_at: string;
  school_id: string;
  schools: { name: string } | null;
  events: { name: string } | null;
}

interface ParticipantActivityRow {
  id: string;
  participant_number: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  created_at: string;
  school_id: string;
  schools: { name: string } | null;
}

interface CoachActivityRow {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  created_at: string;
  schools: { name: string } | null;
}

interface PaperAnswerActivityRow {
  id: string;
  name: string;
  paper_participation: PaperParticipation;
  paper_answered_at: string;
}

interface LockActivityRow {
  id: string;
  name: string;
  submission_locked_at: string;
}

interface PaperUpdateActivityRow {
  id: string;
  paper_name: string | null;
  updated_at: string;
  schools: { name: string } | null;
}

/**
 * What a school said when it answered the contest question — an answer, not a state of
 * participation. 12 schools have answered "yes" against 295 still undecided, so
 * wording this as "is participating" would read as a division-wide tally and be wrong
 * by several times over.
 */
const PARTICIPATION_LABEL: Record<PaperParticipation, string> = {
  yes: "Joining the school paper contest",
  no: "Not joining the school paper contest",
  undecided: "Answered, still undecided",
};

/**
 * Six timestamp columns, one feed, merged by mergeActivityFeed() into a result that
 * also reports whether anything was held back.
 *
 * It takes its client rather than building one, because the dashboard and the activity
 * page guard identically but *size* differently. `limit` is used twice on purpose — once
 * for each source's `.limit()` and once for the merge. Task 12's invariant is that those
 * two numbers must match; giving the function one number instead of two is how that stops
 * being something a caller can get wrong.
 *
 * On the four nullable timestamps, `.not(column, "is", null)` is load-bearing rather
 * than defensive: Postgres sorts NULLs first on a descending order, so without it a
 * table full of unanswered schools would fill the whole page of results with rows that
 * have no timestamp to show. `entries.submitted_at` is `not null` (0001_init.sql:56),
 * so the guard there changes nothing today and is kept only so all six queries read
 * alike.
 *
 * Names go through personLabel(): `coaches.first_name` and `coaches.last_name` both
 * default to '' (0015_restore_coach_name_parts.sql), so surnameFirst() can legitimately
 * return an empty string and "Coach added — " is not a sentence. School names go
 * through joinMeta(), which yields null rather than an empty meta line.
 */
export async function fetchActivity(
  supabase: SupabaseServerClient,
  limit: number
): Promise<ActivityFeed> {
  const [entries, participants, coaches, answers, locks, papers] = await Promise.all([
    supabase
      .from("entries")
      .select("id, submitted_at, school_id, schools(name), events(name)")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(limit)
      .overrideTypes<EntryActivityRow[]>(),
    supabase
      .from("participants")
      .select(
        "id, participant_number, first_name, middle_name, last_name, created_at, school_id, schools(name)"
      )
      .order("created_at", { ascending: false })
      .limit(limit)
      .overrideTypes<ParticipantActivityRow[]>(),
    supabase
      .from("coaches")
      .select("id, first_name, middle_name, last_name, created_at, schools(name)")
      .order("created_at", { ascending: false })
      .limit(limit)
      .overrideTypes<CoachActivityRow[]>(),
    supabase
      .from("schools")
      .select("id, name, paper_participation, paper_answered_at")
      .not("paper_answered_at", "is", null)
      .order("paper_answered_at", { ascending: false })
      .limit(limit)
      .overrideTypes<PaperAnswerActivityRow[]>(),
    supabase
      .from("schools")
      .select("id, name, submission_locked_at")
      .not("submission_locked_at", "is", null)
      .order("submission_locked_at", { ascending: false })
      .limit(limit)
      .overrideTypes<LockActivityRow[]>(),
    supabase
      .from("school_papers")
      .select("id, paper_name, updated_at, schools(name)")
      .order("updated_at", { ascending: false })
      .limit(limit)
      .overrideTypes<PaperUpdateActivityRow[]>(),
  ]);

  return mergeActivityFeed(
    [
      (entries.data ?? []).map((row) => ({
        id: `entry:${row.id}`,
        kind: "entry" as const,
        at: row.submitted_at,
        title: `Entry submitted — ${row.events?.name ?? "event"}`,
        meta: joinMeta(row.schools?.name),
        href: `/admin/entries?school=${row.school_id}`,
      })),
      (participants.data ?? []).map((row) => ({
        id: `participant:${row.id}`,
        kind: "participant" as const,
        at: row.created_at,
        title: `Learner added — ${formatParticipantNumber(row.participant_number)} ${personLabel(
          surnameFirst(row)
        )}`,
        meta: joinMeta(row.schools?.name),
        href: `/admin/participants?school=${row.school_id}`,
      })),
      (coaches.data ?? []).map((row) => ({
        id: `coach:${row.id}`,
        kind: "coach" as const,
        at: row.created_at,
        title: `Coach added — ${personLabel(surnameFirst(row))}`,
        meta: joinMeta(row.schools?.name),
        // /admin/coaches has no school filter to link into, so this lands on the
        // unfiltered list rather than on a parameter the page would ignore.
        href: "/admin/coaches",
      })),
      (answers.data ?? []).map((row) => ({
        id: `paper-answer:${row.id}`,
        kind: "paper-answer" as const,
        at: row.paper_answered_at,
        title: `${row.name} answered the school paper question`,
        meta: PARTICIPATION_LABEL[row.paper_participation],
        href: "/admin/school-papers",
      })),
      (locks.data ?? []).map((row) => ({
        id: `submission-lock:${row.id}`,
        kind: "submission-lock" as const,
        at: row.submission_locked_at,
        title: `${row.name} locked its submissions`,
        meta: "No further changes from the school",
        href: "/admin/school-papers",
      })),
      (papers.data ?? []).map((row) => ({
        id: `paper-update:${row.id}`,
        kind: "paper-update" as const,
        at: row.updated_at,
        title: `School paper updated — ${row.paper_name?.trim() || "untitled"}`,
        meta: joinMeta(row.schools?.name),
        href: "/admin/school-papers",
      })),
    ],
    limit
  );
}
