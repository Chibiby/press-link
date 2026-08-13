import type { EventLanguage, EventLevel } from "@/lib/events-catalog";

export interface ParticipantRow {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
}

export interface CoachRow {
  full_name: string;
  gender: "M" | "F";
}

export interface EntryRow {
  id: string;
  event_id: string;
  submitted_at: string;
  /** Preformatted on the server so the client never re-derives a locale string. */
  submitted_label: string;
  event_type_id: string;
  event_name: string;
  level: EventLevel;
  language: EventLanguage;
  participants: ParticipantRow[];
  coaches: CoachRow[];
}

export interface PaperStaffRow {
  id: string;
  full_name: string;
  title: "section_head" | "assistant_head";
}

export interface SchoolPaperRow {
  id: string;
  language: EventLanguage;
  paper_name: string;
  adviser_name: string;
  adviser_gender: "M" | "F";
  principal_name: string;
  paper_staff: PaperStaffRow[];
}
