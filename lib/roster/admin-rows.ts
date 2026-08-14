import type { PaperDeclineReason } from "@/lib/paper/gate";
import { formatParticipantNumber } from "./limits";

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
    paper_decline_reason: PaperDeclineReason | null;
    paper_decline_note: string | null;
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
  paperParticipation: string;
  /** Why the school said No, and its own wording when the reason is "other". */
  paperDeclineReason: PaperDeclineReason | null;
  paperDeclineNote: string | null;
}

export function toAdminParticipantRows(raw: RawAdminParticipant[]): AdminParticipantRow[] {
  return raw
    .map((row) => {
      const eventCount = row.entry_participants.length;
      const isMultiEvent = eventCount > 1;
      const numberLabel = formatParticipantNumber(row.participant_number);
      const given = [row.first_name, row.middle_name].filter(Boolean).join(" ");
      return {
        id: row.id,
        numberLabel,
        displayNumber: isMultiEvent ? `*${numberLabel}` : numberLabel,
        fullName: [row.last_name, given].filter(Boolean).join(", "),
        gender: row.gender,
        schoolId: row.schools?.id ?? "",
        schoolName: row.schools?.name ?? "",
        districtId: row.schools?.district_id ?? "",
        districtName: row.schools?.districts?.name ?? "",
        eventCount,
        isMultiEvent,
        paperParticipation: row.schools?.paper_participation ?? "undecided",
        paperDeclineReason: row.schools?.paper_decline_reason ?? null,
        paperDeclineNote: row.schools?.paper_decline_note ?? null,
      };
    })
    .sort((a, b) => a.numberLabel.localeCompare(b.numberLabel));
}
