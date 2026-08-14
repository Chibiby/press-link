import type { EventLanguage } from "@/lib/events-catalog";

export type PaperParticipation = "undecided" | "yes" | "no";

/** Both languages are required before a school may do anything else. */
export const REQUIRED_LANGUAGES: EventLanguage[] = ["english", "filipino"];

export type PaperPhase =
  /** Filling English and Filipino. Nothing else is reachable. */
  | "fill"
  /** Both are in; the school has yet to submit them as its entry. */
  | "question"
  /** Submitted. The papers are frozen and the roster is open. */
  | "done";

export interface PaperFlowState {
  phase: PaperPhase;
  /** Force the School Paper form open and refuse to let it be dismissed. */
  paperFormOpen: boolean;
  /** Read-only: the school submitted these papers as its entry. */
  paperFormLocked: boolean;
  askQuestion: boolean;
  /** Participants and coaches stay shut until the papers are submitted. */
  rosterEnabled: boolean;
  /** Languages still owed, in the order the tabs show them. */
  missingLanguages: EventLanguage[];
}

/**
 * The order of business after a school signs in:
 *
 *   1. Fill the English and Filipino school paper. Nothing else opens.
 *   2. "Are you submitting these as your school paper entry?"
 *   3a. Yes -> the papers are submitted and frozen, and the roster opens.
 *   3b. No  -> the answer is recorded and the school is signed out. The
 *       question returns on its next sign-in, so a school that means No stays
 *       out of the roster until the division office resets its answer with
 *       `admin_reset_paper_participation`.
 *
 * Only a Yes moves a school past the question, which is why every other
 * `participation` value with both papers saved lands back on it.
 */
export function paperFlowState(input: {
  participation: PaperParticipation;
  savedLanguages: EventLanguage[];
}): PaperFlowState {
  const { participation, savedLanguages } = input;

  // A submitted school is done regardless of what the papers look like now —
  // re-asking a school that already said Yes would sign it out on a mis-click.
  if (participation === "yes") {
    return {
      phase: "done",
      paperFormOpen: false,
      paperFormLocked: true,
      askQuestion: false,
      rosterEnabled: true,
      missingLanguages: [],
    };
  }

  const saved = new Set(savedLanguages);
  const missing = REQUIRED_LANGUAGES.filter((lang) => !saved.has(lang));

  if (missing.length > 0) {
    return {
      phase: "fill",
      paperFormOpen: true,
      paperFormLocked: false,
      askQuestion: false,
      rosterEnabled: false,
      missingLanguages: missing,
    };
  }

  return {
    phase: "question",
    paperFormOpen: false,
    paperFormLocked: false,
    askQuestion: true,
    rosterEnabled: false,
    missingLanguages: [],
  };
}
