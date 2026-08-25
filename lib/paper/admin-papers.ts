import type { EventLanguage } from "@/lib/events-catalog";
import type { PaperStaffRow } from "@/app/entry/types";
import type { SchoolLevel } from "@/lib/schools/level";
import { PAPER_LANGUAGES, type PaperParticipation } from "./gate";
import { levelBelongsTo, paperSlots, type PaperLevel, type PaperSlot } from "./level";
import { paperStatus, type PaperStatus } from "./status";

/** One filed `school_papers` row, with everything the roster cell for it needs. */
export interface RawAdminSchoolPaperFile {
  language: EventLanguage;
  level: PaperLevel;
  paper_name: string;
  adviser_name: string;
  adviser_gender: "M" | "F";
  principal_name: string;
  paper_staff: PaperStaffRow[];
}

/** A `schools` row joined to its papers and district, as `/admin/school-papers` fetches it. */
export interface RawAdminSchoolPaper {
  id: string;
  name: string;
  district_id: string;
  /** Read from the column. Never re-derived from the school name at runtime. */
  is_integrated: boolean;
  /**
   * Elementary/secondary classification for a non-integrated school; null when
   * unclassified. Read from the column, never re-derived at runtime — see
   * lib/schools/level.ts. Meaningless for an integrated school, which carries
   * its level per paper instead.
   */
  level: SchoolLevel | null;
  paper_participation: PaperParticipation;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  school_papers: RawAdminSchoolPaperFile[];
}

/**
 * The order a school's filed papers are read in wherever more than one of
 * them can name the same thing — the adviser, the principal, a staff member.
 * Elementary before secondary, English before Filipino within each, and the
 * two `whole` entries last because they only ever belong to a non-integrated
 * school, which never holds an elementary or secondary row to conflict with
 * — see `levelBelongsTo`.
 */
const PAPER_PRIORITY: { level: PaperLevel; language: EventLanguage }[] = [
  { level: "elementary", language: "english" },
  { level: "elementary", language: "filipino" },
  { level: "secondary", language: "english" },
  { level: "secondary", language: "filipino" },
  { level: "whole", language: "english" },
  { level: "whole", language: "filipino" },
];

function paperPriority(level: PaperLevel, language: EventLanguage): number {
  return PAPER_PRIORITY.findIndex((slot) => slot.level === level && slot.language === language);
}

/**
 * Drops blanks, drops duplicates keeping first occurrence, joins survivors
 * with ", ".
 *
 * A school with two papers commonly names the same adviser or principal on
 * both — that is one person, not two entries in a cell that is supposed to
 * read as a name, not a list of rows.
 */
export function dedupedJoin(values: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const survivors: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    survivors.push(trimmed);
  }

  return survivors.join(", ");
}

/** Adviser, gender, principal and staff, combined across a school's filed papers. */
export interface CombinedPaperInfo {
  adviser: string;
  gender: string;
  principal: string;
  sectionHead: string;
  assistantHead: string;
}

/**
 * Merges the up-to-four filed papers a school can hold into the five names
 * the roster shows once per school, not once per paper.
 *
 * Each field is deduped on its own rather than the whole row being deduped
 * once: two papers sharing an adviser but not a principal is ordinary (a
 * school reassigns one role and not the other), so tying the fields together
 * would drop a principal that a shared adviser had nothing to do with.
 * `gender` follows the same rule for the same reason — it is not read
 * positionally against `adviser`, it is its own independently-deduped list,
 * which is why two papers can print "M, F" without saying which adviser is
 * which.
 *
 * A stale row that contradicts its school (see `levelBelongsTo`) contributes
 * nothing here either, the same invariant `paperSlots` already enforces for
 * whether the paper counts as filed at all.
 */
export function combinedPaperInfo(
  papers: RawAdminSchoolPaperFile[],
  isIntegrated: boolean
): CombinedPaperInfo {
  const ordered = papers
    .filter((paper) => levelBelongsTo(paper.level, isIntegrated))
    .slice()
    .sort((a, b) => paperPriority(a.level, a.language) - paperPriority(b.level, b.language));

  return {
    adviser: dedupedJoin(ordered.map((paper) => paper.adviser_name)),
    gender: dedupedJoin(ordered.map((paper) => paper.adviser_gender)),
    principal: dedupedJoin(ordered.map((paper) => paper.principal_name)),
    sectionHead: dedupedJoin(
      ordered.flatMap((paper) =>
        paper.paper_staff.filter((staff) => staff.title === "section_head").map((s) => s.full_name)
      )
    ),
    assistantHead: dedupedJoin(
      ordered.flatMap((paper) =>
        paper.paper_staff
          .filter((staff) => staff.title === "assistant_head")
          .map((s) => s.full_name)
      )
    ),
  };
}

/**
 * One cell of the table's grade/language grid: is this level+language on
 * file, and if so, under what title.
 */
export interface GradeLanguageSlot {
  level: "elementary" | "secondary";
  language: EventLanguage;
  title: string | null;
}

/** The four cells in the literal left-to-right order the table renders them. */
const GRADE_LANGUAGE_GRID: { level: "elementary" | "secondary"; language: EventLanguage }[] = [
  { level: "elementary", language: "english" },
  { level: "elementary", language: "filipino" },
  { level: "secondary", language: "english" },
  { level: "secondary", language: "filipino" },
];

/**
 * The four elementary/secondary × English/Filipino cells the table shows for
 * one school.
 *
 * An integrated school answers this from its own papers, each of which
 * already carries a level: a slot's `title` comes from the belonging paper
 * that matches it exactly, or null when none does. A non-integrated school
 * never files a levelled paper — every one of its papers is `whole` — so a
 * slot for it can only resolve by crossing `schools.level` (which grade band
 * the school teaches) with a `whole` paper's language. When that
 * classification is null, every slot here reads null; that is a display gap
 * in this grid alone; it is not grounds to drop the school from the roster,
 * which only asks whether the school has any paper on file at all (see
 * `eligibleSchoolPaperRows`).
 */
export function gradeLanguageSlots(input: {
  isIntegrated: boolean;
  schoolLevel: SchoolLevel | null;
  savedPapers: { language: EventLanguage; level: PaperLevel; paper_name: string }[];
}): GradeLanguageSlot[] {
  const { isIntegrated, schoolLevel, savedPapers } = input;
  const belonging = savedPapers.filter((paper) => levelBelongsTo(paper.level, isIntegrated));

  return GRADE_LANGUAGE_GRID.map((slot) => {
    // `unique (school_id, language, level)` means at most one belonging paper
    // can match a given slot, so there is never a second candidate to choose
    // between here.
    const match = isIntegrated
      ? belonging.find((paper) => paper.level === slot.level && paper.language === slot.language)
      : schoolLevel === slot.level
        ? belonging.find((paper) => paper.level === "whole" && paper.language === slot.language)
        : undefined;

    return { ...slot, title: match?.paper_name ?? null };
  });
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
  /**
   * The four grade/language cells the table renders, left to right. See
   * `gradeLanguageSlots` for how a non-integrated school's `whole` papers map
   * onto elementary or secondary.
   */
  gradeSlots: GradeLanguageSlot[];
  /**
   * The five names `combinedPaperInfo` merges across this school's filed
   * papers, flattened onto the row rather than kept as a nested
   * `CombinedPaperInfo` — every other field here is already a flat column, and
   * the table has one cell per field, not one cell for the group.
   */
  adviser: string;
  gender: string;
  principal: string;
  sectionHead: string;
  assistantHead: string;
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
      const combined = combinedPaperInfo(row.school_papers, row.is_integrated);

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
        gradeSlots: gradeLanguageSlots({
          isIntegrated: row.is_integrated,
          schoolLevel: row.level,
          savedPapers: row.school_papers,
        }),
        adviser: combined.adviser,
        gender: combined.gender,
        principal: combined.principal,
        sectionHead: combined.sectionHead,
        assistantHead: combined.assistantHead,
      };
    })
    .sort((a, b) => {
      // District A→Z, then school A→Z within it — the division reads this
      // roster district by district, never by which school happens to have the
      // most papers or the newest one.
      const byDistrict = a.districtName.localeCompare(b.districtName);
      return byDistrict !== 0 ? byDistrict : a.schoolName.localeCompare(b.schoolName);
    });
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
