import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { adminSignOutAction } from "../actions";
import { ParticipantFilterBar } from "./ParticipantFilterBar";
import { ResetPaperButton } from "./ResetPaperButton";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  toAdminParticipantRows,
  type RawAdminParticipant,
} from "@/lib/roster/admin-rows";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
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
  multi?: string;
}

export default async function AdminParticipantsPage({
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

  const [{ data: districts }, { data: schools }, { data: raw }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
    supabase
      .from("participants")
      .select(
        "id, participant_number, first_name, middle_name, last_name, gender, schools(id, name, district_id, paper_participation, paper_locked_at, school_papers(count), districts(name)), entry_participants(entry_id)"
      )
      .order("participant_number")
      .overrideTypes<RawAdminParticipant[]>(),
  ]);

  // `school_papers(count)` arrives as a one-element array; the row mapper wants
  // a plain number, so it is unwrapped here rather than inside the pure module.
  const rawWithCounts: RawAdminParticipant[] = (raw ?? []).map((row) => ({
    ...row,
    schools: row.schools
      ? {
          ...row.schools,
          paper_count:
            (row.schools as unknown as { school_papers?: { count: number }[] }).school_papers?.[0]
              ?.count ?? 0,
        }
      : null,
  }));
  let rows = toAdminParticipantRows(rawWithCounts);
  if (params.district) rows = rows.filter((r) => r.districtId === params.district);
  if (params.school) rows = rows.filter((r) => r.schoolId === params.school);
  if (params.multi === "1") rows = rows.filter((r) => r.isMultiEvent);

  const multiCount = rows.filter((r) => r.isMultiEvent).length;

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="Participants"
        subtitle="Every registered contestant in the division"
        badge={`${rows.length} listed`}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Roster</h2>
              <p className="text-sm text-muted-foreground">
                An asterisk marks a participant competing in more than one event —{" "}
                {multiCount} shown.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">
                <ArrowLeft className="size-4" />
                Back to entries
              </Link>
            </Button>
          </div>

          <ParticipantFilterBar districts={districts ?? []} schools={schools ?? []} />

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">No.</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead className="w-20">Gender</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead className="w-20">Events</TableHead>
                  <TableHead className="w-44">School paper</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={cn(row.isMultiEvent && "bg-accent/40")}>
                    <TableCell className="font-mono tabular-nums">
                      {row.displayNumber}
                    </TableCell>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell>{row.gender}</TableCell>
                    <TableCell>{row.schoolName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.districtName}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.eventCount}
                      {row.isMultiEvent && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          Multi
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.paperStatus === "incomplete" ? (
                        <span className="text-sm text-muted-foreground">
                          {PAPER_STATUS_LABEL.incomplete}
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={row.paperStatus === "submitted" ? "default" : "secondary"}
                            className="text-[10px]"
                          >
                            {PAPER_STATUS_LABEL[row.paperStatus]}
                          </Badge>
                          {row.paperLocked && (
                            <Badge variant="outline" className="text-[10px]">
                              Locked
                            </Badge>
                          )}
                          <ResetPaperButton
                            schoolId={row.schoolId}
                            schoolName={row.schoolName}
                            locked={row.paperLocked}
                          />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No participants match these filters.
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
