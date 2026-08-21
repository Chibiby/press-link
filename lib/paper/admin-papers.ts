import type { EventLanguage } from "@/lib/events-catalog";
import { PAPER_LANGUAGES, type PaperParticipation } from "./gate";
import { paperSlots, type PaperLevel, type PaperSlot } from "./level";
import { paperStatus, type PaperStatus } from "./status";

/** A `schools` row joined to its papers and district, as `/admin/school-papers` fetches it. */
export interface RawAdminSchoolPaper {
  id: string;
  name: string;
  district_id: string;
  /** Read from the column. Never re-derived from the school name at runtime. */
  is_integrated: boolean;
  paper_participation: PaperParticipation;
  paper_answered_at: string | null;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  school_papers: { language: EventLanguage; level: PaperLevel }[];
}

export interface AdminSchoolPaperRow {
  id: string;
  schoolName: string;
  districtId: string;
  districtName: string;
  status: PaperStatus;
  locked: boolean;
  /** Straight from `schools.is_integrated`, so the table can mark the row. */
  isIntegrated: boolean;
  /**
   * Every paper this school owes, filled or not — two slots, or four when the
   * school is integrated. Produced by `paperSlots`, the one derivation the
   * school's own form and the summary sheet also use, so the admin table cannot
   * disagree with them about what a school still owes.
   */
  slots: PaperSlot[];
  /**
   * Languages with at least one paper on file, in tab order.
   *
   * "On file", not "complete". For every non-integrated school these are the
   * same thing and this is byte-for-byte what the column has always meant. For
   * an integrated school it means one of its two levels has been filed, which is
   * why the completeness claim lives in `completeLanguages` instead.
   */
  languages: EventLanguage[];
  /** Languages with every level the school owes on file. A subset of `languages`. */
  completeLanguages: EventLanguage[];
  answeredAt: string | null;
}

export interface SchoolPaperFilters {
  district?: string;
  school?: string;
  status?: string;
  lock?: string;
  language?: string;
}

export function toAdminSchoolPaperRows(
  raw: RawAdminSchoolPaper[]
): AdminSchoolPaperRow[] {
  return raw
    .map((row) => {
      const slots = paperSlots(row.is_integrated, row.school_papers);

      const languages = PAPER_LANGUAGES.filter((lang) =>
        slots.some((slot) => slot.language === lang && slot.filled)
      );
      const completeLanguages = PAPER_LANGUAGES.filter((lang) =>
        slots.every((slot) => slot.language !== lang || slot.filled)
      );

      return {
        id: row.id,
        schoolName: row.name,
        districtId: row.district_id,
        districtName: row.districts?.name ?? "",
        status: paperStatus({
          participation: row.paper_participation,
          // Papers that actually belong to this school. A stored row whose level
          // contradicts its school fills no slot, so it cannot lift a school out
          // of "not started" on the strength of a paper nobody can see or edit.
          paperCount: slots.filter((slot) => slot.filled).length,
          lockedAt: row.submission_locked_at,
        }),
        locked: row.submission_locked_at != null,
        isIntegrated: row.is_integrated,
        slots,
        languages,
        completeLanguages,
        answeredAt: row.paper_answered_at,
      };
    })
    .sort((a, b) => a.schoolName.localeCompare(b.schoolName));
}

/**
 * Filters arrive as URL search params, so anything at all can be in them. An
 * unrecognised value is treated as no filter rather than as a filter nothing
 * matches — a hand-edited URL should not present an empty table as if the
 * division had no schools.
 *
 * `language` means **has at least one paper in that language, at any level** —
 * which is what the bar calls it, "Language on file (any level)". The other
 * reading, "has all its papers in that language", was rejected: it would change
 * what the filter means for every one of the 300-odd non-integrated schools in
 * order to say something about the handful of integrated ones, and it would hide
 * an integrated school that has genuinely filed an English paper from an admin
 * looking for English papers to read. Completeness is a per-slot fact and the
 * table shows it per slot; it is not what "on file" claims.
 */
export function filterSchoolPaperRows(
  rows: AdminSchoolPaperRow[],
  filters: SchoolPaperFilters
): AdminSchoolPaperRow[] {
  const status = filters.status;
  const lock = filters.lock;
  const language = filters.language;

  return rows.filter((row) => {
    if (filters.district && row.districtId !== filters.district) return false;
    if (filters.school && row.id !== filters.school) return false;
    if (
      (status === "submitted" || status === "saved" || status === "incomplete") &&
      row.status !== status
    ) {
      return false;
    }
    if (lock === "locked" && !row.locked) return false;
    if (lock === "unlocked" && row.locked) return false;
    if (
      (language === "english" || language === "filipino") &&
      !row.languages.includes(language)
    ) {
      return false;
    }
    return true;
  });
}
