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
