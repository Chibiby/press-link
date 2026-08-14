import type { EventLanguage } from "@/lib/events-catalog";

export type PaperParticipation = "undecided" | "yes" | "no";

/** Both languages are required before a school may do anything else. */
export const REQUIRED_LANGUAGES: EventLanguage[] = ["english", "filipino"];

export interface SavedPaper {
  language: EventLanguage;
  /** ISO timestamp of the last save, used to spot a post-answer re-save. */
  updatedAt: string;
}

export type PaperPhase =
  /** Filling English and Filipino for the first time. */
  | "fill"
  /** Both are in; the school has yet to say whether it is submitting them. */
  | "question"
  /** Answered No, so the papers must be re-saved before anything else. */
  | "refill"
  /** Nothing outstanding. */
  | "done";

export interface PaperFlowState {
  phase: PaperPhase;
  /** Force the School Paper form open and refuse to let it be dismissed. */
  paperFormOpen: boolean;
  /** Read-only: the school confirmed these papers as its entry. */
  paperFormLocked: boolean;
  /** Prefill blank fields with N/A — only once the school has answered No. */
  allowNotApplicable: boolean;
  askQuestion: boolean;
  /** Participants and coaches stay shut until the paper business is settled. */
  rosterEnabled: boolean;
  /** Languages still owed, in the order the tabs show them. */
  missingLanguages: EventLanguage[];
}

/**
 * The order of business after a school signs in:
 *
 *   1. Fill the English and Filipino school paper.
 *   2. Answer "are you submitting these as your school paper entry?".
 *   3a. Yes -> the two papers are locked as submitted, and the roster opens.
 *   3b. No  -> the papers are re-opened, N/A is accepted, and the roster stays
 *       shut until both have been saved again.
 *
 * Only `admin_reset_paper_participation` moves a school back to step 2.
 */
export function paperFlowState(input: {
  participation: PaperParticipation;
  /** When the school answered, so a re-save can be told from the original. */
  answeredAt: string | null;
  papers: SavedPaper[];
}): PaperFlowState {
  const { participation, answeredAt, papers } = input;

  const savedLanguages = new Set(papers.map((p) => p.language));
  const missingBeforeAnswer = REQUIRED_LANGUAGES.filter((lang) => !savedLanguages.has(lang));

  if (participation === "undecided") {
    if (missingBeforeAnswer.length > 0) {
      return {
        phase: "fill",
        paperFormOpen: true,
        paperFormLocked: false,
        allowNotApplicable: false,
        askQuestion: false,
        rosterEnabled: false,
        missingLanguages: missingBeforeAnswer,
      };
    }
    return {
      phase: "question",
      paperFormOpen: false,
      paperFormLocked: false,
      allowNotApplicable: false,
      askQuestion: true,
      rosterEnabled: false,
      missingLanguages: [],
    };
  }

  if (participation === "yes") {
    return {
      phase: "done",
      paperFormOpen: false,
      paperFormLocked: true,
      allowNotApplicable: false,
      askQuestion: false,
      rosterEnabled: true,
      missingLanguages: [],
    };
  }

  // Answered No. Only a save at or after the answer counts — the papers filled
  // to reach the question were written on the understanding that they were
  // being submitted, so the school confirms them again knowing they are not.
  const answered = answeredAt === null ? null : Date.parse(answeredAt);
  const stale = REQUIRED_LANGUAGES.filter((lang) => {
    const paper = papers.find((p) => p.language === lang);
    if (!paper || answered === null) return true;
    return Date.parse(paper.updatedAt) < answered;
  });

  if (stale.length > 0) {
    return {
      phase: "refill",
      paperFormOpen: true,
      paperFormLocked: false,
      allowNotApplicable: true,
      askQuestion: false,
      rosterEnabled: false,
      missingLanguages: stale,
    };
  }

  return {
    phase: "done",
    paperFormOpen: false,
    paperFormLocked: false,
    allowNotApplicable: true,
    askQuestion: false,
    rosterEnabled: true,
    missingLanguages: [],
  };
}
