export type PaperParticipation = "undecided" | "yes" | "no";

/** Why a school answered No. Null for any other answer. */
export type PaperDeclineReason =
  | "submit_later"
  | "no_paper_yet"
  | "will_not_submit"
  | "other";

/** Insertion order drives the dropdown, so keep it in the order schools read. */
export const DECLINE_REASON_LABELS: Record<PaperDeclineReason, string> = {
  submit_later: "We will submit later",
  no_paper_yet: "We do not have a school paper yet",
  will_not_submit: "We will not submit a school paper",
  other: "Other reason (please specify)",
};

export const DECLINE_REASONS = Object.keys(DECLINE_REASON_LABELS) as PaperDeclineReason[];

/** Reasons that close the School Paper form until an admin reopens it. */
const LOCKING_REASONS: PaperDeclineReason[] = ["will_not_submit", "other"];

export interface PaperGateState {
  /** Show the Yes/No question again on the next visit. */
  askAgain: boolean;
  /** Whether the school may still open and save its School Paper form. */
  paperFormEnabled: boolean;
}

/**
 * The single source of truth for how a school's paper answer affects it.
 *
 * A school is nagged while its answer leaves something outstanding — it has not
 * answered, it said Yes but saved nothing, or it asked to submit later. Saying
 * it has no paper yet is a settled answer that still leaves the form open;
 * only a firm refusal (or a free-text reason the division office has not read
 * yet) closes the form, and `admin_reset_paper_participation` is the way back.
 */
export function paperGateState(input: {
  participation: PaperParticipation;
  declineReason: PaperDeclineReason | null;
  savedLanguageCount: number;
}): PaperGateState {
  const { participation, declineReason, savedLanguageCount } = input;

  if (participation === "undecided") {
    return { askAgain: true, paperFormEnabled: true };
  }

  if (participation === "yes") {
    return { askAgain: savedLanguageCount === 0, paperFormEnabled: true };
  }

  // A No with no reason stored predates this column (or lost it to an admin
  // edit). Ask again rather than guessing a reason that could lock the school
  // out of a form it never refused.
  if (declineReason === null) {
    return { askAgain: true, paperFormEnabled: true };
  }

  if (declineReason === "submit_later") {
    return { askAgain: true, paperFormEnabled: true };
  }

  return {
    askAgain: false,
    paperFormEnabled: !LOCKING_REASONS.includes(declineReason),
  };
}
