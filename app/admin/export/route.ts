import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { createClient } from "@/lib/supabase/server";
import { buildEntriesWorkbook, type ExportEntry } from "@/lib/export/entries-workbook";
import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import { distinctCoaches } from "@/lib/roster/entry-coaches";
import { surnameFirst } from "@/lib/roster/names";
import { fetchAll, LoadFailure } from "@/lib/supabase/fetch-all";

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
  entry_coaches: {
    coaches: {
      id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      gender: "M" | "F";
    } | null;
  }[];
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
  const school = params.get("school");
  const event = params.get("event");

  // Paged, not one select. This is the worse half of the truncation: a spreadsheet is
  // filed as a record, so a clipped read does not produce a short screen somebody
  // refreshes — it produces an official-looking entry list with rows missing and a
  // date on it. At 977 entries the table is about twenty short of the `db-max-rows`
  // cap PostgREST applies without saying so. `.order("id")` breaks the `submitted_at`
  // tie (`not null default now()`, not unique — a school files in one second), which
  // LIMIT/OFFSET needs or a boundary row lands in two windows or neither.
  let rawEntries: EntryRow[];
  try {
    rawEntries = await fetchAll<EntryRow>("Entries", (from, to) => {
      let query = supabase
        .from("entries")
        .select(
          "id, submitted_at, schools(name, district_id, districts(name)), events(name, category, level, language), entry_participants(participants(participant_number, first_name, middle_name, last_name, gender)), entry_coaches(coaches(id, first_name, middle_name, last_name, gender))"
        );

      if (school) query = query.eq("school_id", school);
      if (event) query = query.eq("event_id", event);

      return query
        .order("submitted_at", { ascending: false })
        .order("id")
        .range(from, to)
        .overrideTypes<EntryRow[]>();
    });
  } catch (failure) {
    // 500 and no file, never a partial workbook: a download that half-worked is
    // indistinguishable from a complete one once it is saved.
    if (!(failure instanceof LoadFailure)) throw failure;
    return NextResponse.json({ error: "Could not load entries" }, { status: 500 });
  }

  // Same post-fetch narrowing as the admin page, so the file matches the screen.
  const district = params.get("district");
  const category = params.get("category");
  const level = params.get("level");
  const language = params.get("language");

  const filtered = rawEntries.filter((entry) => {
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
    coaches: distinctCoaches(entry.entry_coaches).map((c) => ({
      fullName: surnameFirst(c),
      gender: c.gender,
    })),
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
