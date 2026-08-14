import type { EventLanguage } from "@/lib/events-catalog";

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
  /** Read-only: the school locked its details in. */
  paperFormLocked: boolean;
  /** Ask the contest question with no way out — it has never been answered. */
  askQuestion: boolean;
  /** The answer may still be given or changed. */
  canAnswer: boolean;
  /** Answered, so the details can be frozen. */
  canLock: boolean;
  /** Participants and coaches, open once both stages are behind the school. */
  rosterEnabled: boolean;
  /** Languages actually on file, deduped and in PAPER_LANGUAGES order. */
  savedLanguages: EventLanguage[];
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
 * Everything stays editable afterwards until the school locks its details in,
 * which is the only thing that freezes them — and only the division office can
 * reopen a locked school, with `admin_reset_paper_participation`.
 */
export function paperFlowState(input: {
  participation: PaperParticipation;
  savedLanguages: EventLanguage[];
  lockedAt: string | null;
}): PaperFlowState {
  const { participation, lockedAt } = input;
  const saved = new Set(input.savedLanguages);
  const savedLanguages = PAPER_LANGUAGES.filter((lang) => saved.has(lang));
  const locked = lockedAt !== null;

  // A locked school is finished with all of this. Re-opening the form or the
  // question for it would only produce writes the database refuses anyway.
  if (locked) {
    return {
      phase: "done",
      paperFormOpen: false,
      paperFormLocked: true,
      askQuestion: false,
      canAnswer: false,
      canLock: false,
      rosterEnabled: true,
      savedLanguages,
    };
  }

  if (savedLanguages.length === 0) {
    return {
      phase: "fill",
      paperFormOpen: true,
      paperFormLocked: false,
      askQuestion: false,
      canAnswer: false,
      canLock: false,
      rosterEnabled: false,
      savedLanguages,
    };
  }

  if (participation === "undecided") {
    return {
      phase: "question",
      paperFormOpen: false,
      paperFormLocked: false,
      askQuestion: true,
      canAnswer: true,
      canLock: false,
      rosterEnabled: false,
      savedLanguages,
    };
  }

  return {
    phase: "done",
    paperFormOpen: false,
    paperFormLocked: false,
    askQuestion: false,
    canAnswer: true,
    canLock: true,
    rosterEnabled: true,
    savedLanguages,
  };
}
