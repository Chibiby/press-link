/**
 * The wording every empty judging table uses.
 *
 * Shared so the roster, the panel index and both boards cannot each invent their
 * own sentence for the same absence. An admin who sees three different wordings on
 * one screen reasonably concludes three different things are wrong.
 *
 * These replaced a pair that named migration 0018 and said the tables were not
 * there. They are there now, so an empty table is an empty table: a fact about the
 * roster, not about the schema. Every sentence here has to survive that difference,
 * because the two absences call for different responses — a missing table is
 * someone's job to fix, an empty one is someone's job to fill.
 */

/** No judge has been added yet. The table exists and was read; it held nothing. */
export const NO_JUDGES_ON_FILE =
  "No judge has been added yet. The roster is empty, so no panel can be seated.";

/**
 * Why a round's progress cell is not a ratio.
 *
 * `boardProgress` returns 0 of 0 both for an event with no panel and for an event
 * with no entries, and those are different facts an admin would act on differently.
 * Neither is printed as a ratio, because "0 of 0 ranks filed" invites the reading
 * that the ranks are all in.
 */
export const NO_PANEL_SEATED = "No panel is seated, so there are no ranks to count.";

/** The panel is seated; there is simply nothing for it to rank. */
export const NO_ENTRIES_TO_RANK = "This event has no entries, so there is nothing to rank.";

/**
 * Why a round-2 cut cell is blank.
 *
 * `events.round2_cut` is `not null default 10`, so this is unreachable while the
 * read succeeds — it stands for the case where the column came back with nothing.
 * Note what it does *not* say: that the cut is 10. Printing the division's usual
 * default in place of an unread value would invent a decision (non-negotiable 5).
 */
export const CUT_NOT_ON_FILE = "No round-2 cut is on file for this event.";
