import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { createClient } from "@/lib/supabase/server";
import { buildEntriesWorkbook, type ExportEntry } from "@/lib/export/entries-workbook";
import type { EventLanguage, EventLevel } from "@/lib/events-catalog";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface EntryRow {
  id: string;
  submitted_at: string | null;
  schools: { name: string; district_id: string; districts: { name: string } | null } | null;
  events: {
    name: string;
    category: "individual" | "group";
    level: EventLevel;
    language: EventLanguage;
  } | null;
  entry_participants: {
    participants: {
      participant_number: number;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      gender: "M" | "F";
    } | null;
  }[];
  entry_coaches: { coaches: { full_name: string; gender: "M" | "F" } | null }[];
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // A route handler is reachable on its own — re-check admin here rather than
  // trusting proxy.ts to have gated the path.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;

  let query = supabase
    .from("entries")
    .select(
      "id, submitted_at, schools(name, district_id, districts(name)), events(name, category, level, language), entry_participants(participants(participant_number, first_name, middle_name, last_name, gender)), entry_coaches(coaches(full_name, gender))"
    )
    .order("submitted_at", { ascending: false });

  const school = params.get("school");
  const event = params.get("event");
  if (school) query = query.eq("school_id", school);
  if (event) query = query.eq("event_id", event);

  const { data: rawEntries, error } = await query.overrideTypes<EntryRow[]>();
  if (error) {
    return NextResponse.json({ error: "Could not load entries" }, { status: 500 });
  }

  // Same post-fetch narrowing as the admin page, so the file matches the screen.
  const district = params.get("district");
  const category = params.get("category");
  const level = params.get("level");
  const language = params.get("language");

  const filtered = (rawEntries ?? []).filter((entry) => {
    if (district && entry.schools?.district_id !== district) return false;
    if (category && entry.events?.category !== category) return false;
    if (level && entry.events?.level !== level) return false;
    if (language && entry.events?.language !== language) return false;
    return true;
  });

  const exportEntries: ExportEntry[] = filtered.map((entry) => ({
    schoolName: entry.schools?.name ?? "",
    districtName: entry.schools?.districts?.name ?? "",
    eventName: entry.events?.name ?? "",
    category: entry.events?.category ?? "individual",
    level: entry.events?.level ?? "elementary",
    language: entry.events?.language ?? "english",
    submittedAt: entry.submitted_at ? DATE_FORMAT.format(new Date(entry.submitted_at)) : null,
    participants: entry.entry_participants
      .map((link) => link.participants)
      .filter((p) => p !== null)
      .map((p) => ({
        participantNumber: p.participant_number,
        firstName: p.first_name,
        middleName: p.middle_name,
        lastName: p.last_name,
        gender: p.gender,
      })),
    coaches: entry.entry_coaches
      .map((link) => link.coaches)
      .filter((c) => c !== null)
      .map((c) => ({ fullName: c.full_name, gender: c.gender })),
  }));

  const book = buildEntriesWorkbook(exportEntries);
  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="press-link-entries-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
