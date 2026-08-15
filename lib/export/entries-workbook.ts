import * as XLSX from "xlsx";

import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirstCamel } from "@/lib/roster/names";

export interface ExportEntry {
  schoolName: string;
  districtName: string;
  eventName: string;
  category: "individual" | "group";
  level: EventLevel;
  language: EventLanguage;
  submittedAt: string | null;
  participants: {
    participantNumber: number;
    firstName: string;
    middleName: string | null;
    lastName: string;
    gender: "M" | "F";
  }[];
  coaches: { fullName: string; gender: "M" | "F" }[];
}

export interface ExportRow {
  "No.": string;
  School: string;
  District: string;
  Event: string;
  Category: string;
  Level: string;
  Language: string;
  Participant: string;
  Gender: string;
  Coaches: string;
  Submitted: string;
}

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const fullName = surnameFirstCamel;

/**
 * One row per participant — a 3-member group entry becomes 3 rows carrying
 * identical entry-level fields, which is what the division office sorts on.
 */
export function toExportRows(entries: ExportEntry[]): ExportRow[] {
  const rows: ExportRow[] = [];

  for (const entry of entries) {
    const base = {
      School: entry.schoolName,
      District: entry.districtName,
      Event: entry.eventName,
      Category: titleCase(entry.category),
      Level: titleCase(entry.level),
      Language: titleCase(entry.language),
      Coaches: entry.coaches.map((c) => `${c.fullName} (${c.gender})`).join("; "),
      Submitted: entry.submittedAt ?? "",
    };

    if (entry.participants.length === 0) {
      rows.push({ ...base, "No.": "", Participant: "", Gender: "" });
      continue;
    }

    for (const participant of entry.participants) {
      rows.push({
        ...base,
        "No.": formatParticipantNumber(participant.participantNumber),
        Participant: fullName(participant),
        Gender: participant.gender,
      });
    }
  }

  return rows;
}

export function buildEntriesWorkbook(entries: ExportEntry[]): XLSX.WorkBook {
  const rows = toExportRows(entries);
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      "No.",
      "School",
      "District",
      "Event",
      "Category",
      "Level",
      "Language",
      "Participant",
      "Gender",
      "Coaches",
      "Submitted",
    ],
  });
  sheet["!cols"] = [8, 32, 22, 34, 12, 12, 10, 30, 8, 34, 20].map((wch) => ({ wch }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Entries");
  return book;
}
