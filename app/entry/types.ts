import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import type { PaperLevel } from "@/lib/paper/level";

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
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
  /** "Dela Cruz, Ana M." — built once on the server. */
  full_name: string;
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
  /**
   * The people coaching this entry, each listed once. A coach may cover more than
   * one contestant, so this is shorter than the number of link rows behind it.
   */
  coaches: RosterCoach[];
  /**
   * Contestant id to the id of the coach paired with them.
   *
   * Only individual entries pair anyone, and only entries filed after migration
   * 0019 — see `coachingPending`. A group entry's coaches belong to the whole
   * team, so this is always empty for one.
   */
  coachByParticipant: Record<string, string>;
  /**
   * An individual entry whose coaches are on record but not yet matched to
   * contestants, because it was filed before the pairing existed.
   *
   * Nothing about the entry is lost: its coaches are still listed. What the
   * school owes is which of them coaches whom, which it settles the next time it
   * opens the entry.
   */
  coachingPending: boolean;
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
  /**
   * Which half of an integrated school this paper covers, or `whole` for the
   * one paper every other school files. Carried on the row rather than inferred
   * from the school, so the dialog can put each saved paper back in the field
   * that produced it.
   */
  level: PaperLevel;
  /** Last save, used to tell a post-answer re-save from the original. */
  updated_at: string;
  paper_name: string;
  adviser_name: string;
  adviser_gender: "M" | "F";
  principal_name: string;
  paper_staff: PaperStaffRow[];
}


/**
 * A school paper retired by migration 0017 because the school turned out to be
 * integrated and now owes one paper per level.
 *
 * Read-only, and shown to the school so it is not asked to re-type an adviser and
 * a set of section heads it already submitted once. Staff is jsonb here rather
 * than a joined table: the archive inlines it, because paper_staff cascades away
 * with the row it belonged to.
 */
export interface ArchivedPaperRow {
  id: string;
  language: EventLanguage;
  paper_name: string;
  adviser_name: string;
  principal_name: string;
  archived_at: string;
  staff: { full_name: string; title: string }[];
}
