import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { adminSignOutAction } from "../actions";
import { CoachFilterBar } from "./CoachFilterBar";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  toAdminCoachRows,
  filterCoachRows,
  type RawAdminCoach,
} from "@/lib/roster/admin-coach-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface SearchParams {
  district?: string;
  school?: string;
  gender?: string;
  multi?: string;
  unassigned?: string;
  event?: string;
  category?: string;
  level?: string;
  language?: string;
}

export default async function AdminCoachesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .single();
  if (!profile) {
    await supabase.auth.signOut();
    redirect("/admin/login");
  }

  const [{ data: districts }, { data: schools }, { data: events }, { data: raw }] =
    await Promise.all([
      supabase.from("districts").select("id, name").order("name"),
      supabase.from("schools").select("id, name, district_id").order("name"),
      supabase.from("events").select("id, name").order("sort_order"),
      supabase
        .from("coaches")
        .select(
          "id, full_name, gender, schools(id, name, district_id, districts(name)), entry_coaches(entries(id, event_id, events(category, level, language)))"
        )
        .order("full_name")
        .overrideTypes<RawAdminCoach[]>(),
    ]);

  const rows = filterCoachRows(toAdminCoachRows(raw ?? []), params);

  const multiCount = rows.filter((r) => r.isMultiEntry).length;

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="Coaches"
        subtitle="Every registered coach in the division"
        badge={`${rows.length} listed`}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Roster</h2>
              <p className="text-sm text-muted-foreground">
                An asterisk marks a coach on more than one entry — {multiCount} shown.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">
                <ArrowLeft className="size-4" />
                Back to entries
              </Link>
            </Button>
          </div>

          <CoachFilterBar
            districts={districts ?? []}
            schools={schools ?? []}
            events={events ?? []}
          />

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Coach</TableHead>
                  <TableHead className="w-20">Gender</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead className="w-24">Entries</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={cn(row.isMultiEntry && "bg-accent/40")}>
                    <TableCell className="font-medium">{row.displayName}</TableCell>
                    <TableCell>{row.gender}</TableCell>
                    <TableCell>{row.schoolName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.districtName}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.entryCount}
                      {row.isMultiEntry && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          Multi
                        </Badge>
                      )}
                      {row.entryCount === 0 && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Unassigned
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No coaches match these filters.
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
