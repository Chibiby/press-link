import Link from "next/link";
import { Building2, FileText, Newspaper, User, UserCog, Users } from "lucide-react";

import { requireAdmin } from "./guard";
import { adminSignOutAction } from "./actions";
import { FilterBar } from "./FilterBar";
import { DashboardHeader } from "@/components/dashboard-header";
import { LanguageBadge, LevelBadge } from "@/components/entry-badges";
import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import type { PaperParticipation } from "@/lib/paper/gate";
import { PAPER_STATUS_LABEL, paperStatus } from "@/lib/paper/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface SearchParams {
  district?: string;
  school?: string;
  event?: string;
  category?: string;
  level?: string;
  language?: string;
}

interface EntryRow {
  id: string;
  submitted_at: string;
  schools: { name: string; district_id: string; districts: { name: string } | null } | null;
  events: {
    name: string;
    category: "individual" | "group";
    level: EventLevel;
    language: EventLanguage;
  } | null;
  entry_participants: {
    participants: { participant_number: number; first_name: string; last_name: string } | null;
  }[];
  entry_coaches: { coaches: { full_name: string } | null }[];
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  const [
    { data: districts },
    { data: schools },
    { data: events },
    { data: paperSchools },
  ] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
    supabase.from("events").select("id, name").order("sort_order"),
    supabase
      .from("schools")
      .select("paper_participation, submission_locked_at, school_papers(count)")
      .overrideTypes<
        {
          paper_participation: PaperParticipation;
          submission_locked_at: string | null;
          school_papers: { count: number }[];
        }[]
      >(),
  ]);

  let query = supabase
    .from("entries")
    .select(
      "id, submitted_at, schools(name, district_id, districts(name)), events(name, category, level, language), entry_participants(participants(participant_number, first_name, last_name)), entry_coaches(coaches(full_name))"
    )
    .order("submitted_at", { ascending: false });

  if (params.school) query = query.eq("school_id", params.school);
  if (params.event) query = query.eq("event_id", params.event);

  const { data: rawEntries, error: entriesError } = await query.overrideTypes<EntryRow[]>();

  // District, category, level and language live on joined tables, so they are
  // narrowed here rather than in the query.
  const filteredEntries = (rawEntries ?? []).filter((entry) => {
    if (params.district && entry.schools?.district_id !== params.district) return false;
    if (params.category && entry.events?.category !== params.category) return false;
    if (params.level && entry.events?.level !== params.level) return false;
    if (params.language && entry.events?.language !== params.language) return false;
    return true;
  });

  const stats = {
    total: filteredEntries.length,
    schools: new Set(filteredEntries.map((e) => e.schools?.name).filter(Boolean)).size,
    individual: filteredEntries.filter((e) => e.events?.category === "individual").length,
    group: filteredEntries.filter((e) => e.events?.category === "group").length,
  };

  // How the division's schools stand on their school papers, independent of the
  // entry filters above — this counts schools, not entries.
  const paperStats = (paperSchools ?? []).reduce(
    (acc, row) => {
      const status = paperStatus({
        participation: row.paper_participation,
        paperCount: row.school_papers?.[0]?.count ?? 0,
        lockedAt: row.submission_locked_at,
      });
      acc[status] += 1;
      return acc;
    },
    { incomplete: 0, saved: 0, submitted: 0 }
  );

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="Division Admin"
        subtitle="All school submissions"
        badge={`${(paperSchools ?? []).length} schools`}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Entries</h2>
              <p className="text-sm text-muted-foreground">
                Every entry submitted across the division.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/participants">
                  <Users className="size-4" />
                  Participants
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/coaches">
                  <UserCog className="size-4" />
                  Coaches
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/school-papers">
                  <Newspaper className="size-4" />
                  School Papers
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={<FileText className="size-4" />} label="Entries" value={stats.total} />
            <Stat icon={<Building2 className="size-4" />} label="Schools" value={stats.schools} />
            <Stat icon={<User className="size-4" />} label="Individual" value={stats.individual} />
            <Stat icon={<Users className="size-4" />} label="Group" value={stats.group} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              icon={<Newspaper className="size-4" />}
              label={PAPER_STATUS_LABEL.submitted}
              value={paperStats.submitted}
            />
            <Stat
              icon={<Newspaper className="size-4" />}
              label={PAPER_STATUS_LABEL.saved}
              value={paperStats.saved}
            />
            <Stat
              icon={<Newspaper className="size-4" />}
              label={PAPER_STATUS_LABEL.incomplete}
              value={paperStats.incomplete}
            />
          </div>

          <FilterBar districts={districts ?? []} schools={schools ?? []} events={events ?? []} />

          {entriesError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load entries</AlertTitle>
              <AlertDescription>
                The entries could not be loaded. Please try refreshing the page.
              </AlertDescription>
            </Alert>
          ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Participant(s)</TableHead>
                  <TableHead>Coach(es)</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.schools?.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.schools?.districts?.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {entry.events?.name}
                        {entry.events?.category === "group" && (
                          <Badge variant="secondary" className="text-[10px]">
                            Group
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {entry.events && <LevelBadge level={entry.events.level} />}
                    </TableCell>
                    <TableCell>
                      {entry.events && <LanguageBadge language={entry.events.language} />}
                    </TableCell>
                    <TableCell>
                      {entry.entry_participants
                        .map((link) => link.participants)
                        .filter((p) => p !== null)
                        .map((p) => `${p.first_name} ${p.last_name}`)
                        .join(", ")}
                    </TableCell>
                    <TableCell>
                      {entry.entry_coaches
                        .map((link) => link.coaches)
                        .filter((c) => c !== null)
                        .map((c) => c.full_name)
                        .join(", ")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {entry.submitted_at ? DATE_FORMAT.format(new Date(entry.submitted_at)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      No entries match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
