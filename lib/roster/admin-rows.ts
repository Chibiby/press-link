import { formatParticipantNumber } from "./limits";
import { surnameFirst } from "./names";
import type { PaperParticipation } from "@/lib/paper/gate";
import { paperStatus, type PaperStatus } from "@/lib/paper/status";

/** A `participants` row joined to its school and entry links, as fetched by /admin/participants. */
export interface RawAdminParticipant {
  id: string;
  participant_number: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
  schools: {
    id: string;
    name: string;
    district_id: string;
    paper_participation: string;
    submission_locked_at: string | null;
    /** From the `school_papers(count)` aggregate on the page's query. */
    paper_count: number;
    districts: { name: string } | null;
  } | null;
  entry_participants: { entry_id: string }[];
}

export interface AdminParticipantRow {
  id: string;
  numberLabel: string;
  /** Asterisked when the participant sits in more than one event. */
  displayNumber: string;
  fullName: string;
  gender: "M" | "F";
  schoolId: string;
  schoolName: string;
  districtId: string;
  districtName: string;
  eventCount: number;
  isMultiEvent: boolean;
  /**
   * Whether this contestant is in any event at all.
   *
   * Derived from the entries on file and from nothing else — not from who filed
   * them. A learner a school entered and a learner an administrator entered are the
   * same fact about the contest, and a status that distinguished them would be
   * reporting the console's own history where the roster needs the division's.
   *
   * It duplicates `eventCount > 0` on purpose. The count answers "how many"; this
   * answers "at all", which is the question the roster is scanned for — and a column
   * of noughts is read as a number nobody has got round to rather than as a learner
   * who is in nothing.
   */
  entryStatus: ParticipantEntryStatus;
  paperStatus: PaperStatus;
  submissionLocked: boolean;
}

/** Entered in something, or in nothing. There is no third state. */
export type ParticipantEntryStatus = "entered" | "none";

/** The one wording for each, so no surface invents its own. */
export const PARTICIPANT_ENTRY_STATUS_LABEL: Record<ParticipantEntryStatus, string> = {
  entered: "Entered",
  none: "No entry",
};

export function toAdminParticipantRows(raw: RawAdminParticipant[]): AdminParticipantRow[] {
  return raw
    .map((row) => {
      const eventCount = row.entry_participants.length;
      const isMultiEvent = eventCount > 1;
      const numberLabel = formatParticipantNumber(row.participant_number);
      return {
        id: row.id,
        numberLabel,
        displayNumber: isMultiEvent ? `*${numberLabel}` : numberLabel,
        fullName: surnameFirst(row),
        gender: row.gender,
        schoolId: row.schools?.id ?? "",
        schoolName: row.schools?.name ?? "",
        districtId: row.schools?.district_id ?? "",
        districtName: row.schools?.districts?.name ?? "",
        eventCount,
        entryStatus: eventCount > 0 ? ("entered" as const) : ("none" as const),
        isMultiEvent,
        paperStatus: paperStatus({
          participation: (row.schools?.paper_participation ??
            "undecided") as PaperParticipation,
          paperCount: row.schools?.paper_count ?? 0,
          lockedAt: row.schools?.submission_locked_at ?? null,
        }),
        submissionLocked: row.schools?.submission_locked_at != null,
      };
    })
    .sort((a, b) => a.numberLabel.localeCompare(b.numberLabel));
}
