/**
 * The dashboard's "needs attention" list.
 *
 * Each item pairs a count with the link that filters a page down to the rows
 * that produced it. Defining both here is the point of the module: a count and a
 * link that describe slightly different conditions is a bug nobody notices until
 * someone follows the link and gets a different number.
 *
 * Order is fixed, not sorted by size — a list that reshuffles as the data moves
 * is hard to build a habit around.
 */
export type AttentionKey =
  | "learners-no-entry"
  | "schools-no-entry"
  | "coaches-no-entry"
  | "paper-not-started";

export interface AttentionInput {
  learnersWithoutEntry: number;
  schoolsWithLearnersButNoEntry: number;
  coachesWithoutEntry: number;
  schoolsPaperNotStarted: number;
}

export interface AttentionItem {
  key: AttentionKey;
  label: string;
  detail: string;
  count: number;
  href: string | null;
  tone: "warn" | "info";
}

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const all: AttentionItem[] = [
    {
      key: "learners-no-entry",
      label: "Learners with no entry",
      detail: "Registered on a school roster but not entered in any event.",
      count: input.learnersWithoutEntry,
      href: "/admin/participants?unassigned=1",
      tone: "warn",
    },
    {
      key: "schools-no-entry",
      label: "Schools with learners but no entry",
      detail: "A roster was built and then nothing was submitted.",
      count: input.schoolsWithLearnersButNoEntry,
      href: "/admin/schools?status=learners-no-entry",
      tone: "warn",
    },
    {
      key: "coaches-no-entry",
      label: "Coaches with no entry",
      detail: "Registered as a coach but not attached to an entry.",
      count: input.coachesWithoutEntry,
      href: "/admin/coaches?unassigned=1",
      tone: "warn",
    },
    {
      key: "paper-not-started",
      // Worded to match paperStatus()'s "Not started", which is what the linked
      // filter selects. The spec's "undecided" is narrower than ?status=incomplete
      // and would have put a different number here from the one on that page.
      label: "Schools that have not started their school paper",
      detail: "No answer on participation yet, or answered with nothing saved.",
      count: input.schoolsPaperNotStarted,
      href: "/admin/school-papers?status=incomplete",
      tone: "info",
    },
  ];

  return all.filter((item) => item.count > 0);
}

/** The bell's badge: how many categories need attention, not how many rows. */
export function attentionBadge(items: AttentionItem[]): number {
  return items.length;
}
