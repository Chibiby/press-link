import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

/** A person on the school's roster, ready to be picked into an entry. */
export interface RosterParticipant {
  id: string;
  participant_number: number;
  /** Zero-padded on the server so no component re-derives it. */
  number_label: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
  /** "Dela Cruz, Ana M." — built once on the server. */
  full_name: string;
}

export interface RosterCoach {
  id: string;
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
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  participants: RosterParticipant[];
  coaches: RosterCoach[];
}

/** Re-exported so the paper rules live in exactly one module. */
export type { PaperParticipation } from "@/lib/paper/gate";

export interface PaperStaffRow {
  id: string;
  full_name: string;
  title: "section_head" | "assistant_head";
}

export interface SchoolPaperRow {
  id: string;
  language: EventLanguage;
  /** Last save, used to tell a post-answer re-save from the original. */
  updated_at: string;
  paper_name: string;
  adviser_name: string;
  adviser_gender: "M" | "F";
  principal_name: string;
  paper_staff: PaperStaffRow[];
}
