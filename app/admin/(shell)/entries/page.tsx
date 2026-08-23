import Link from "next/link";
import { Building2, FileText, Newspaper, User, Users } from "lucide-react";

import { requireAdmin } from "@/app/admin/guard";
import { FilterBar } from "@/app/admin/FilterBar";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { LanguageBadge, LevelBadge } from "@/components/entry-badges";
import {
  entryCoachNames,
  entryEmptyState,
  entryParticipantNames,
  filterEntryRows,
  type EntryFilters,
} from "@/lib/entries/admin-entry-filters";
import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import type { PaperParticipation } from "@/lib/paper/gate";
import { PAPER_STATUS_LABEL, paperStatus } from "@/lib/paper/status";
import { fetchAll, LoadFailure } from "@/lib/supabase/fetch-all";
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
  entry_coaches: {
    coaches: {
      id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    } | null;
  }[];
}

export default async function AdminEntriesPage({
  searchParams,
}: {
  // `EntryFilters` rather than a shape declared here: the page, the filter it
  // hands these to and the export route that re-reads them cannot then disagree
  // about a param's name, which is a mistake with no symptom other than a control
  // that silently does nothing.
  searchParams: Promise<EntryFilters>;
}) {
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

  // Paged, not one select. `entries` stands at 977 rows against a `db-max-rows` cap
  // PostgREST applies silently, so this table is roughly twenty entries from
  // rendering a short list with no error to branch on. The `.order("id")` is load
  // bearing: `submitted_at` is `not null default now()` but not unique — a school
  // files its entries in the same second — and LIMIT/OFFSET over a tied ORDER BY can
  // place the same row in two windows or neither. Migration 0018 breaks the same tie
  // the same way when it numbers entries by `(submitted_at, id)`.
  let rawEntries: EntryRow[] = [];
  let entriesError: LoadFailure | null = null;

  try {
    rawEntries = await fetchAll<EntryRow>("Entries", (from, to) => {
      let query = supabase
        .from("entries")
        .select(
          "id, submitted_at, schools(name, district_id, districts(name)), events(name, category, level, language), entry_participants(participants(participant_number, first_name, last_name)), entry_coaches(coaches(id, first_name, middle_name, last_name))"
        );

      if (params.school) query = query.eq("school_id", params.school);
      if (params.event) query = query.eq("event_id", params.event);

      return query
        .order("submitted_at", { ascending: false })
        .order("id")
        .range(from, to)
        .overrideTypes<EntryRow[]>();
    });
  } catch (failure) {
    // Reported, never partial: the alert below is the whole table's replacement, so a
    // read that could not finish shows as a failure rather than as fewer entries.
    if (!(failure instanceof LoadFailure)) throw failure;
    entriesError = failure;
  }

  // Both halves live in `lib/entries/admin-entry-filters.ts`, tested there: which
  // rows survive the search and the dropdowns, and the sentence to print when that
  // is none of them. `app/admin/export/route.ts` reads the same two functions, so
  // the workbook behind the Export button cannot answer a different question from
  // the table it was taken from.
  const filteredEntries = filterEntryRows(rawEntries, params);
  const empty = entryEmptyState(params);

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
    <div className="group flex flex-col gap-6">
      <PageHeading
        title="Entries"
        subtitle="Every entry submitted across the division."
        badge={`${filteredEntries.length} of ${rawEntries.length} entries`}
      />

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
      /* Dimmed while the filter bar's navigation is still rendering on the
         server, so the table reads as catching up rather than as ignoring what
         was typed. Driven by `data-pending` on the bar above. */
      <div className="overflow-x-auto rounded-xl border transition-opacity group-has-data-pending:opacity-50">
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
                  {/* The same two helpers the search reads, so a name that
                      matched is a name printed here. */}
                  {entryParticipantNames(entry).join(", ")}
                </TableCell>
                <TableCell>{entryCoachNames(entry).join(", ")}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {entry.submitted_at ? DATE_FORMAT.format(new Date(entry.submitted_at)) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {filteredEntries.length === 0 && (
              <TableRow>
                {/* `whitespace-normal`, because `TableCell` sets
                    `whitespace-nowrap` in its base and this cell quotes back
                    whatever was typed — a pasted line would otherwise stretch the
                    table into a sideways scroll instead of wrapping. */}
                <TableCell colSpan={8} className="py-10 text-center whitespace-normal">
                  <p className="mx-auto max-w-[60ch] text-sm text-balance break-words text-muted-foreground">
                    {empty.message}
                  </p>
                  {empty.narrowed && (
                    // A way back, on the table itself. The Clear button in the bar
                    // above also covers this — `SEARCH_PARAM` is first in
                    // `ENTRY_FILTER_KEYS` — but an empty table is where the reader
                    // is looking, and a link is the honest control for it in a
                    // server component. Navigating here empties the search box
                    // too: the box follows the URL, so it clears when the param
                    // goes.
                    <Button asChild size="sm" variant="outline" className="mt-3">
                      <Link href="/admin/entries">Show all entries</Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      )}
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
