import ExcelJS from "exceljs";

import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirstCamel } from "@/lib/roster/names";

import { addExportFooter, addExportHeader } from "./letterhead";

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

const HEADERS = [
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
] as const;

const COLUMN_WIDTHS = [8, 32, 22, 34, 12, 12, 10, 30, 8, 34, 20];

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

export function buildEntriesWorkbook(entries: ExportEntry[]): ExcelJS.Workbook {
  const rows = toExportRows(entries);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Entries");
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "landscape" };
  const headerRowIndex = addExportHeader(workbook, sheet);
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  sheet.getRow(headerRowIndex).values = [...HEADERS];

  rows.forEach((row, i) => {
    sheet.getRow(headerRowIndex + 1 + i).values = HEADERS.map((header) => row[header]);
  });

  addExportFooter(workbook, sheet, headerRowIndex + rows.length);

  return workbook;
}
