import { redirect } from "next/navigation";
import { Building2, FileText, User, Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { adminSignOutAction } from "./actions";
import { FilterBar } from "./FilterBar";
import { LockToggle } from "./LockToggle";
import { DashboardHeader } from "@/components/dashboard-header";
import { LanguageBadge, LevelBadge } from "@/components/entry-badges";
import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import { Badge } from "@/components/ui/badge";
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
  entry_participants: { first_name: string; last_name: string }[];
  entry_coaches: { full_name: string }[];
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase.from("admin_profiles").select("user_id").eq("user_id", user.id).single();
  if (!profile) {
    await supabase.auth.signOut();
    redirect("/admin/login");
  }

  const [{ data: districts }, { data: schools }, { data: events }, { data: settings }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
    supabase.from("events").select("id, name").order("sort_order"),
    supabase.from("app_settings").select("submissions_locked").single(),
  ]);

  let query = supabase
    .from("entries")
    .select(
      "id, submitted_at, schools(name, district_id, districts(name)), events(name, category, level, language), entry_participants(first_name, last_name), entry_coaches(full_name)"
    )
    .order("submitted_at", { ascending: false });

  if (params.school) query = query.eq("school_id", params.school);
  if (params.event) query = query.eq("event_id", params.event);

  const { data: rawEntries } = await query.overrideTypes<EntryRow[]>();

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

  const locked = settings?.submissions_locked ?? false;

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="Division Admin"
        subtitle="All school submissions"
        badge={locked ? "Locked" : "Open"}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Entries</h2>
              <p className="text-sm text-muted-foreground">
                {locked
                  ? "Submissions are locked — schools cannot make changes."
                  : "Submissions are open."}
              </p>
            </div>
            <LockToggle locked={locked} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={<FileText className="size-4" />} label="Entries" value={stats.total} />
            <Stat icon={<Building2 className="size-4" />} label="Schools" value={stats.schools} />
            <Stat icon={<User className="size-4" />} label="Individual" value={stats.individual} />
            <Stat icon={<Users className="size-4" />} label="Group" value={stats.group} />
          </div>

          <FilterBar districts={districts ?? []} schools={schools ?? []} events={events ?? []} />

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
                        .map((p) => `${p.first_name} ${p.last_name}`)
                        .join(", ")}
                    </TableCell>
                    <TableCell>
                      {entry.entry_coaches.map((c) => c.full_name).join(", ")}
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
