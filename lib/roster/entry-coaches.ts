/**
 * The distinct people behind an entry's coach links.
 *
 * `entry_coaches` holds one row per coach per contestant, so a coach who takes
 * two contestants in the same contest is two rows naming one person. Every list
 * that reads coaches is a list of people — a cell in the entries table, a
 * judging sheet, a column in the export — so each of them asks for this rather
 * than mapping the rows straight through, which would print the name twice.
 *
 * Deduped by id and never by name: a division of a thousand coaches has two
 * people called the same thing, and both belong on the sheet. First-seen order
 * is kept so a list does not reshuffle between loads.
 */
export function distinctCoaches<T extends { id: string }>(
  links: { coaches: T | null }[] | null | undefined
): T[] {
  const byId = new Map<string, T>();
  for (const link of links ?? []) {
    const coach = link.coaches;
    if (coach && !byId.has(coach.id)) byId.set(coach.id, coach);
  }
  return [...byId.values()];
}

/** A contestant on an individual entry, with the coach matched to them. */
export interface CoachedContestant<P, C> {
  participant: P;
  /**
   * Null only where the entry itself has no answer — a contestant no coach was
   * matched to. Never a coach the entry does not have.
   */
  coach: C | null;
}

/**
 * An individual entry's contestants in roster order, each carrying their coach.
 *
 * The repeat is the point. A school that sends one coach for three contestants
 * gets that name under all three, because the question a reader has is who coaches
 * this learner, and the honest answer is the same person three times. Deduping
 * here would answer a different question — how many coaches the entry has — which
 * is what `distinctCoaches` above is for.
 *
 * Roster order, not the order the link rows came back in: it is the order the
 * school's own participants tab shows, and the order migration 0021 paired names
 * in, so a school checking an assumed pairing can read the two side by side.
 */
export function coachedContestants<
  P extends { id: string; participant_number: number },
  C extends { id: string },
>(
  participants: P[],
  coaches: C[],
  coachByParticipant: Record<string, string>
): CoachedContestant<P, C>[] {
  const byId = new Map(coaches.map((coach) => [coach.id, coach]));

  // Copied before sorting: `participants` belongs to a row the page built, and
  // sorting in place would reorder it for every other reader of that row.
  return [...participants]
    .sort((a, b) => a.participant_number - b.participant_number)
    .map((participant) => {
      const coachId = coachByParticipant[participant.id];
      return { participant, coach: coachId ? byId.get(coachId) ?? null : null };
    });
}
