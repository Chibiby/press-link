import type { PaperParticipation } from "./gate";

/**
 * What a school's school paper amounts to, in the three words the division
 * office cares about. Derived here so the school dashboard and both admin
 * pages cannot drift apart on the wording.
 */
export type PaperStatus = "incomplete" | "saved" | "submitted";

export const PAPER_STATUS_LABEL: Record<PaperStatus, string> = {
  incomplete: "Not started",
  saved: "Info saved only",
  submitted: "Submitted to contest",
};

export function paperStatus(input: {
  participation: PaperParticipation;
  paperCount: number;
  lockedAt: string | null;
}): PaperStatus {
  const { participation, paperCount, lockedAt } = input;

  // An answer only means something alongside the information it was given
  // about — except for a locked school, whose answer is final whatever its
  // rows look like now.
  if (participation === "undecided") return "incomplete";
  if (paperCount < 1 && lockedAt === null) return "incomplete";
  return participation === "yes" ? "submitted" : "saved";
}
