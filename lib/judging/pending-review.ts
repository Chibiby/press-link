/**
 * How many events have a judge's sheet waiting on the office.
 *
 * The number on the Tabulators item in the sidebar. Judging happens at a venue
 * across a day: sheets arrive one at a time, and the act that follows each — close
 * round 1, publish the results — belongs to somebody who is not in the room. Until
 * now the only way to learn that a sheet had landed was to open the judges portal
 * and read forty rows, so a submitted sheet could sit for hours because nobody
 * thought to look.
 *
 * ## What counts as waiting
 *
 * A submitted sheet in a round that is still open. Submitting *is* locking for a
 * judge — a sheet cannot be saved without being submitted (N6) — so "a judge has
 * filed something you have not acted on" is exactly a round with a submission and
 * no lock over it.
 *
 * Counted by event and not by sheet. Three round 2 judges filing on the same event
 * is one thing for an officer to do, and a badge reading 3 would send them looking
 * for three.
 */

/** One `judge_sheets` row, as the badge's query selects it. */
export interface PendingSheet {
  event_id: string;
  round: number;
  submitted_at: string | null;
}

/** One `event_rounds` row: what has already been closed on that event. */
export interface PendingRound {
  event_id: string;
  round1_locked_at: string | null;
  results_locked_at: string | null;
}

export function pendingJudgeReviewCount(
  sheets: PendingSheet[],
  rounds: PendingRound[]
): number {
  const byEvent = new Map(rounds.map((row) => [row.event_id, row]));
  const waiting = new Set<string>();

  for (const sheet of sheets) {
    if (sheet.submitted_at === null) continue;

    const round = byEvent.get(sheet.event_id);
    // No `event_rounds` row means nothing has been closed on this event at all,
    // which is the most waiting an event can be rather than the least.
    const round1Locked = round?.round1_locked_at != null;
    const resultsLocked = round?.results_locked_at != null;

    // A published event is finished, whatever is submitted underneath it.
    if (resultsLocked) continue;

    if (sheet.round === 1) {
      // A round 1 sheet under a closed round 1 has already been acted on: closing
      // the round is the act, and it drew its qualifier list from this sheet.
      if (!round1Locked) waiting.add(sheet.event_id);
      continue;
    }

    // A round 2 sheet on an event whose results are not published is outstanding
    // work by definition — the panel may not be complete yet, and the office still
    // has the publication to make when it is.
    waiting.add(sheet.event_id);
  }

  return waiting.size;
}
