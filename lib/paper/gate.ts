import type { EventLanguage } from "@/lib/events-catalog";

import { levelBelongsTo, levelsForSchool, type PaperLevel } from "./level";

export type PaperParticipation = "undecided" | "yes" | "no";

/** The languages a school may publish in, in the order the tabs show them. */
export const PAPER_LANGUAGES: EventLanguage[] = ["english", "filipino"];

export type PaperPhase =
  /** Stage 1: no language on file yet. Nothing else is reachable. */
  | "fill"
  /** Stage 2: the contest question, which has never been answered. */
  | "question"
  /** Both stages behind it. The roster is open. */
  | "done";

export interface PaperFlowState {
  phase: PaperPhase;
  /** Force the School Paper form open and refuse to let it be dismissed. */
  paperFormOpen: boolean;
  /** Read-only: the school locked its whole submission — paper, roster and entries. */
  submissionLocked: boolean;
  /** Ask the contest question with no way out — it has never been answered. */
  askQuestion: boolean;
  /** The answer may still be given or changed. */
  canAnswer: boolean;
  /** Answered, with at least one entry, so the submission can be frozen. */
  canLock: boolean;
  /** Participants and coaches, open once both stages are behind the school. */
  rosterEnabled: boolean;
  /** Languages actually on file, deduped and in PAPER_LANGUAGES order. */
  savedLanguages: EventLanguage[];
  /**
   * Levels this school owes a paper for and has not filed one at. Empty once
   * stage 1 is cleared, and always empty for a locked school, which could not
   * act on it anyway.
   */
  missingLevels: PaperLevel[];
}

/**
 * The order of business after a school signs in:
 *
 *   1. Save the school paper information for English, Filipino, or both. One
 *      language is enough; nothing else opens until one exists.
 *   2. "Are you submitting this school paper to the school paper contest?"
 *   3. Either answer opens participants and coaches. Yes records a contest
 *      submission, No retains the information only, and neither signs the
 *      school out.
 *
 * Everything stays editable afterwards until the school locks its whole
 * submission, which is the only thing that freezes it — and only the division
 * office can reopen a locked school, with `admin_unlock_submission`.
 */
export function paperFlowState(input: {
  participation: PaperParticipation;
  /** Every paper row on file for the school, with the level each one covers. */
  savedPapers: { language: EventLanguage; level: PaperLevel }[];
  /** Reads `schools.is_integrated`; decides how many levels the school owes. */
  isIntegrated: boolean;
  lockedAt: string | null;
  /** The school's current entry count. */
  entryCount: number;
}): PaperFlowState {
  const { participation, lockedAt, isIntegrated } = input;

  // A row whose level contradicts its school is stale — left behind when the
  // school was reclassified — and cannot stand in for a paper it owes.
  const papers = input.savedPapers.filter((paper) =>
    levelBelongsTo(paper.level, isIntegrated)
  );
  const saved = new Set(papers.map((paper) => paper.language));
  const savedLanguages = PAPER_LANGUAGES.filter((lang) => saved.has(lang));

  // Stage 1 is per LEVEL, not per language. An ordinary school owes one paper
  // and any language clears it, exactly as before. An integrated school owes an
  // elementary paper and a secondary one, each in whichever language it likes —
  // two elementary papers do not cover secondary.
  const missingLevels = levelsForSchool(isIntegrated).filter(
    (level) => !papers.some((paper) => paper.level === level)
  );
  const locked = lockedAt !== null;

  // A locked school is finished with all of this. Re-opening the form or the
  // question for it would only produce writes the database refuses anyway.
  if (locked) {
    return {
      phase: "done",
      paperFormOpen: false,
      submissionLocked: true,
      askQuestion: false,
      canAnswer: false,
      canLock: false,
      rosterEnabled: true,
      savedLanguages,
      missingLevels: locked ? [] : missingLevels,
    };
  }

  if (missingLevels.length > 0) {
    return {
      phase: "fill",
      paperFormOpen: true,
      submissionLocked: false,
      askQuestion: false,
      canAnswer: false,
      canLock: false,
      rosterEnabled: false,
      savedLanguages,
      missingLevels: locked ? [] : missingLevels,
    };
  }

  if (participation === "undecided") {
    return {
      phase: "question",
      paperFormOpen: false,
      submissionLocked: false,
      askQuestion: true,
      canAnswer: true,
      canLock: false,
      rosterEnabled: false,
      savedLanguages,
      missingLevels: locked ? [] : missingLevels,
    };
  }

  return {
    phase: "done",
    paperFormOpen: false,
    submissionLocked: false,
    askQuestion: false,
    canAnswer: true,
    canLock: input.entryCount > 0,
    rosterEnabled: true,
    savedLanguages,
    // Reached only when nothing is missing, so this is [] by construction — but
    // written out rather than hardcoded, so a future branch cannot silently
    // claim completeness it has not checked.
    missingLevels,
  };
}
