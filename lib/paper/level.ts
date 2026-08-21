import type { EventLanguage } from "@/lib/events-catalog";
import { PAPER_LANGUAGES } from "./gate";

/**
 * Which level a school paper covers.
 *
 * Three values, because there are three real situations and collapsing any two
 * of them loses information the division needs:
 *
 * - `whole`      — the school publishes one paper per language. This is every
 *                  non-integrated school, and it is what every row on file
 *                  before migration 0016 means.
 * - `elementary` — an integrated school's elementary paper.
 * - `secondary`  — an integrated school's secondary paper.
 *
 * `whole` is deliberately not spelled as `null`. Postgres treats NULLs as
 * distinct in a unique constraint, so `unique (school_id, language, level)` with
 * a nullable level would happily accept two English papers for the same school —
 * exactly the duplicate the constraint exists to prevent.
 */
export type PaperLevel = "whole" | "elementary" | "secondary";

/** Order the levels are shown in, and the order the two-paper form lays them out. */
export const INTEGRATED_LEVELS: PaperLevel[] = ["elementary", "secondary"];

export const PAPER_LEVEL_LABEL: Record<PaperLevel, string> = {
  whole: "School paper",
  elementary: "Elementary",
  secondary: "Secondary",
};

const ALL: PaperLevel[] = ["whole", "elementary", "secondary"];

export function isPaperLevel(value: string | null | undefined): value is PaperLevel {
  return value !== null && value !== undefined && (ALL as string[]).includes(value);
}

/**
 * The levels a given school owes a paper for, per language.
 *
 * One call site decides this for the whole app: an integrated school owes two
 * papers per language and every other school owes one. A page that asked the
 * question itself would be a second place for the answer to drift.
 */
export function levelsForSchool(isIntegrated: boolean): PaperLevel[] {
  return isIntegrated ? [...INTEGRATED_LEVELS] : ["whole"];
}

/**
 * Whether a stored row belongs to the school that holds it.
 *
 * The pairing — integrated schools hold only levelled rows, others hold only
 * `whole` rows — cannot be a database CHECK, because a CHECK on `school_papers`
 * cannot see `schools.is_integrated`. So it is enforced here, and read paths use
 * it to ignore a row that contradicts its school rather than rendering a paper
 * that should not exist.
 */
export function levelBelongsTo(level: PaperLevel, isIntegrated: boolean): boolean {
  return isIntegrated ? level !== "whole" : level === "whole";
}

/** One paper a school owes: a language at a level, and whether it is on file. */
export interface PaperSlot {
  language: EventLanguage;
  level: PaperLevel;
  filled: boolean;
}

/**
 * Every paper a school owes, in display order, marked filled or not.
 *
 * An ordinary school owes two — English and Filipino, both `whole`. An
 * integrated school owes four: each language at each level. Language-major
 * order, so the two levels of one language sit together and the form reads
 * "English: elementary, secondary".
 *
 * Shared rather than derived per surface because three places ask this question
 * — the school's own form, the admin papers table and the summary sheet — and
 * three derivations is three chances to disagree about what a school still owes.
 *
 * A stored row whose level contradicts its school (see `levelBelongsTo`) fills
 * nothing: it is stale data from before a school was reclassified, and counting
 * it would report a paper the school cannot see or edit.
 */
export function paperSlots(
  isIntegrated: boolean,
  saved: { language: EventLanguage; level: PaperLevel }[]
): PaperSlot[] {
  const onFile = new Set(
    saved
      .filter((row) => levelBelongsTo(row.level, isIntegrated))
      .map((row) => `${row.language}:${row.level}`)
  );

  return PAPER_LANGUAGES.flatMap((language) =>
    levelsForSchool(isIntegrated).map((level) => ({
      language,
      level,
      filled: onFile.has(`${language}:${level}`),
    }))
  );
}
