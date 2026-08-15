/** The name columns `participants` and `coaches` share. */
export interface NameParts {
  first_name: string;
  middle_name: string | null;
  last_name: string;
}

/**
 * "Dela Cruz, Ana Mercado" — the order the division office lists people in.
 *
 * Built on the server and passed down as a string, so no component re-derives
 * it and no two surfaces can disagree about the format. Empty parts drop out
 * rather than leaving a dangling comma: a coach migrated from the old single
 * name field has no first name until its school fills one in.
 */
export function surnameFirst(parts: NameParts): string {
  const given = [parts.first_name, parts.middle_name].filter(Boolean).join(" ");
  return [parts.last_name, given].filter(Boolean).join(", ");
}
