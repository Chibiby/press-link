import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { LanguageBadge, LevelBadge } from "@/components/entry-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  summariseRegistration,
  type RegistrationEntry,
} from "@/lib/dashboard/registration-summary";
import { fetchSchoolFacts } from "@/lib/dashboard/school-facts";
import {
  LANGUAGE_LABEL,
  type EventCategory,
  type EventLanguage,
  type EventLevel,
} from "@/lib/events-catalog";
import type { PaperParticipation } from "@/lib/paper/gate";
import { PAPER_LEVEL_LABEL, paperSlots, type PaperLevel } from "@/lib/paper/level";
import { PAPER_STATUS_LABEL, paperStatus } from "@/lib/paper/status";
import { surnameFirst } from "@/lib/roster/names";

/**
 * Manila time, explicitly. The division reads its own clock, and a server in another
 * zone must not shift a submission onto the previous day. Same reason
 * `lib/dashboard/activity.ts` pins its formatter.
 */
const DATE_TIME = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

interface SchoolHeadRow {
  id: string;
  name: string;
  school_id_number: string;
  paper_participation: PaperParticipation;
  /** True when the school runs elementary and secondary under one school id, and so
   *  files two papers per language instead of one. Read from the column, never
   *  re-derived from the name — the office can correct the column by hand. */
  is_integrated: boolean;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  participants: { count: number }[];
  coaches: { count: number }[];
  school_papers: { count: number }[];
}

interface EntryDetailRow {
  id: string;
  submitted_at: string;
  events: {
    id: string;
    name: string;
    category: EventCategory;
    level: EventLevel;
    language: EventLanguage;
    sort_order: number;
  } | null;
  entry_participants: {
    participants: {
      id: string;
      participant_number: number;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    } | null;
  }[];
  entry_coaches: {
    coaches: {
      id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    } | null;
  }[];
}

interface PaperDetailRow {
  language: EventLanguage;
  level: PaperLevel;
  paper_name: string;
  adviser_name: string;
  principal_name: string;
  submitted_at: string | null;
}

/** One labelled figure in the "On record" strip. */
function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * How one paper is named on this sheet.
 *
 * A non-integrated school's only level is `whole`, and printing "English — School
 * paper" beside every row of 300-odd schools says nothing. The level is spelled out
 * exactly when there is a second paper it could be confused with.
 */
function paperLabel(language: EventLanguage, level: PaperLevel, withLevel: boolean) {
  return withLevel
    ? `${LANGUAGE_LABEL[language]} — ${PAPER_LEVEL_LABEL[level]}`
    : LANGUAGE_LABEL[language];
}

export default async function AdminSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  // No school chosen: the picker. One query — the same rollup the dashboard reads.
  if (!params.school) {
    const facts = await fetchSchoolFacts(supabase);
    const silent = facts.registeredSchools - facts.active.length;

    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          title="Summary of Registration"
          subtitle="One school's entries, learners and coaches, on one page."
          badge={`${facts.active.length} schools with data`}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pick a school</CardTitle>
            <CardDescription>
              Every school that has registered a learner, a coach or an entry.
              {silent > 0
                ? ` ${silent} more are on the division list with nothing on record yet.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead className="text-right">Learners</TableHead>
                  <TableHead className="text-right">Coaches</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {facts.active.map((school) => (
                  <TableRow key={school.schoolId}>
                    <TableCell className="font-medium">{school.schoolName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {school.districtName || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {school.learners}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{school.coaches}</TableCell>
                    <TableCell className="text-right tabular-nums">{school.entries}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/summary?school=${school.schoolId}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [{ data: school }, { data: rawEntries }, { data: papers }] = await Promise.all([
    supabase
      .from("schools")
      .select(
        "id, name, school_id_number, paper_participation, is_integrated, submission_locked_at, districts(name), participants(count), coaches(count), school_papers(count)"
      )
      .eq("id", params.school)
      .maybeSingle()
      .overrideTypes<SchoolHeadRow>(),
    supabase
      .from("entries")
      .select(
        "id, submitted_at, events(id, name, category, level, language, sort_order), entry_participants(participants(id, participant_number, first_name, middle_name, last_name)), entry_coaches(coaches(id, first_name, middle_name, last_name))"
      )
      .eq("school_id", params.school)
      .overrideTypes<EntryDetailRow[]>(),
    supabase
      .from("school_papers")
      .select("language, level, paper_name, adviser_name, principal_name, submitted_at")
      .eq("school_id", params.school)
      // Language first, then level: an integrated school's two English papers sit
      // together, elementary above secondary (which is also plain alphabetical order).
      .order("language")
      .order("level")
      .overrideTypes<PaperDetailRow[]>(),
  ]);

  // Covers both ways this can miss: no such school, and a `?school=` that is not a uuid at
  // all — PostgREST rejects that one as 22P02 and returns null data, not a thrown error.
  if (!school) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          title="Summary of Registration"
          subtitle="No school matches that link."
        />
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              The school id in the address is not one this account can read. It may have
              been mistyped, or the school may since have been removed.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-4">
              <Link href="/admin/summary">Back to the school list</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const entries: RegistrationEntry[] = (rawEntries ?? []).flatMap((row) =>
    // An entry whose event row did not come back has nothing to name it. That is a broken
    // foreign key, not a layout decision, so it is dropped rather than printed blank.
    row.events
      ? [
          {
            entryId: row.id,
            eventId: row.events.id,
            eventName: row.events.name,
            category: row.events.category,
            level: row.events.level,
            language: row.events.language,
            sortOrder: row.events.sort_order,
            submittedAt: row.submitted_at,
            participants: row.entry_participants
              .map((link) => link.participants)
              .filter((person): person is NonNullable<typeof person> => person !== null)
              .map((person) => ({
                id: person.id,
                name: surnameFirst(person),
                number: person.participant_number,
              })),
            coaches: row.entry_coaches
              .map((link) => link.coaches)
              .filter((coach): coach is NonNullable<typeof coach> => coach !== null)
              .map((coach) => ({ id: coach.id, name: surnameFirst(coach), number: null })),
          },
        ]
      : []
  );

  const summary = summariseRegistration(entries);
  const rosterLearners = school.participants?.[0]?.count ?? 0;
  const rosterCoaches = school.coaches?.[0]?.count ?? 0;
  const locked = school.submission_locked_at !== null;
  const status = paperStatus({
    participation: school.paper_participation,
    paperCount: school.school_papers?.[0]?.count ?? 0,
    lockedAt: school.submission_locked_at,
  });

  // The single derivation of what this school owes, shared with the school's own paper
  // form and the admin papers table. An ordinary school has two slots — English and
  // Filipino, both `whole`; an integrated school has four, each language at each level.
  const slots = paperSlots(school.is_integrated, papers ?? []);
  const slotsOnFile = slots.filter((slot) => slot.filled).length;
  const slotsMissing = slots.filter((slot) => !slot.filled);

  // The Level column earns its place only when there is something to tell apart: an
  // integrated school always, plus any school holding a row whose level contradicts it.
  // That second case is stale data from a reclassification, and an officer should see it
  // rather than have it silently flattened into an unlabelled duplicate.
  const showLevel =
    school.is_integrated || (papers ?? []).some((paper) => paper.level !== "whole");

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Summary of Registration"
        subtitle={
          school.is_integrated ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {school.name}
              <Badge variant="outline">Integrated</Badge>
            </span>
          ) : (
            school.name
          )
        }
        badge={school.school_id_number}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/summary">All schools</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">On record</CardTitle>
          <CardDescription>
            {school.districts?.name
              ? `${school.districts.name} district`
              : "No district on file"}
            {school.is_integrated
              ? " · Integrated school: elementary and secondary run under this one school id, so it files a paper for each level in each language — four below, not two."
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Entries"
            value={`${summary.entryCount}`}
            note="One per event — a school cannot enter an event twice"
          />
          {/* "of" here is the roster, not the division. The two counts differ on purpose:
              the left is learners named in an entry, the right is everyone the school has
              registered. The gap is who is sitting out. */}
          <Fact
            label="Learners entered"
            value={`${summary.learnersEntered} of ${rosterLearners}`}
            note="Of the learners on this school's roster"
          />
          <Fact
            label="Coaches entered"
            value={`${summary.coachesEntered} of ${rosterCoaches}`}
            note="Of the coaches on this school's roster"
          />
          <Fact
            label="Registration"
            value={locked ? "Closed" : "Open"}
            note={
              locked && school.submission_locked_at
                ? `Locked ${DATE_TIME.format(new Date(school.submission_locked_at))}`
                : "Still accepting changes"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {school.is_integrated ? "School papers" : "School paper"}
          </CardTitle>
          <CardDescription>
            {PAPER_STATUS_LABEL[status]} · {slotsOnFile} of {slots.length} on file
            {/* Named, not counted, and deliberately not called "outstanding": one language
                is enough to clear the paper gate, so a blank slot is a fact about the
                sheet, not a debt the school has failed to pay. */}
            {slotsMissing.length > 0
              ? ` · nothing on file for ${slotsMissing
                  .map((slot) => paperLabel(slot.language, slot.level, school.is_integrated))
                  .join(", ")}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(papers ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing on file. The school paper contest is answered per school on{" "}
              <Link href="/admin/school-papers" className="underline underline-offset-4">
                School Papers
              </Link>
              .
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Language</TableHead>
                  {showLevel ? <TableHead>Level</TableHead> : null}
                  <TableHead>Paper</TableHead>
                  <TableHead>Adviser</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(papers ?? []).map((paper) => (
                  // Language stopped being unique at migration 0016. An integrated school
                  // holds an Elementary English row and a Secondary English row, and
                  // key={paper.language} would collide between them — React would reuse one
                  // row's DOM for the other and drop the second from the list. The stored
                  // constraint is unique (school_id, language, level); this page is a single
                  // school, so language+level is exactly as unique here as the database is.
                  <TableRow key={`${paper.language}:${paper.level}`}>
                    <TableCell>{LANGUAGE_LABEL[paper.language]}</TableCell>
                    {showLevel ? (
                      <TableCell>
                        <Badge variant={paper.level === "secondary" ? "default" : "outline"}>
                          {PAPER_LEVEL_LABEL[paper.level]}
                        </Badge>
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">{paper.paper_name}</TableCell>
                    <TableCell>{paper.adviser_name}</TableCell>
                    <TableCell>{paper.principal_name}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {paper.submitted_at
                        ? DATE_TIME.format(new Date(paper.submitted_at))
                        : "Saved, not submitted"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entries</CardTitle>
          <CardDescription>
            In the catalog&apos;s order. The number beside a learner is their division-wide
            participant id.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This school has a roster but no entries yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Learners</TableHead>
                  <TableHead>Coaches</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.entries.map((entry) => (
                  <TableRow key={entry.entryId} className="align-top">
                    <TableCell>
                      <p className="font-medium">{entry.eventName}</p>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <LevelBadge level={entry.level} />
                        <LanguageBadge language={entry.language} />
                        <Badge variant="secondary">
                          {entry.category === "group" ? "Group" : "Individual"}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell>
                      <ul className="space-y-0.5">
                        {entry.participants.map((person) => (
                          <li key={person.id}>
                            {person.name}
                            {person.number === null ? null : (
                              <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                                #{person.number}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell>
                      <ul className="space-y-0.5">
                        {entry.coaches.map((coach) => (
                          <li key={coach.id}>{coach.name}</li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {DATE_TIME.format(new Date(entry.submittedAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
