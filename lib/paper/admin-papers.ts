import type { EventLanguage } from "@/lib/events-catalog";
import type { PaperParticipation } from "./gate";
import { paperStatus, type PaperStatus } from "./status";

/** A `schools` row joined to its papers and district, as `/admin/school-papers` fetches it. */
export interface RawAdminSchoolPaper {
  id: string;
  name: string;
  district_id: string;
  paper_participation: PaperParticipation;
  paper_answered_at: string | null;
  paper_locked_at: string | null;
  districts: { name: string } | null;
  school_papers: { language: EventLanguage }[];
}

export interface AdminSchoolPaperRow {
  id: string;
  schoolName: string;
  districtId: string;
  districtName: string;
  status: PaperStatus;
  locked: boolean;
  /** Languages on file, deduped and in tab order. */
  languages: EventLanguage[];
  answeredAt: string | null;
}

export interface SchoolPaperFilters {
  district?: string;
  school?: string;
  status?: string;
  lock?: string;
  language?: string;
}

/** Tab order, so a row reads the same way as the school's own dialog. */
const LANGUAGE_ORDER: EventLanguage[] = ["english", "filipino"];

export function toAdminSchoolPaperRows(
  raw: RawAdminSchoolPaper[]
): AdminSchoolPaperRow[] {
  return raw
    .map((row) => {
      const saved = new Set(row.school_papers.map((p) => p.language));
      return {
        id: row.id,
        schoolName: row.name,
        districtId: row.district_id,
        districtName: row.districts?.name ?? "",
        status: paperStatus({
          participation: row.paper_participation,
          paperCount: saved.size,
          lockedAt: row.paper_locked_at,
        }),
        locked: row.paper_locked_at != null,
        languages: LANGUAGE_ORDER.filter((lang) => saved.has(lang)),
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
