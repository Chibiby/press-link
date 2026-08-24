/** The seven municipalities the division's 23 districts fall under. */
export const MUNICIPALITIES = [
  "Alabel",
  "Glan",
  "Kiamba",
  "Maasim",
  "Maitum",
  "Malapatan",
  "Malungon",
] as const;

export type Municipality = (typeof MUNICIPALITIES)[number];

/**
 * `districts.name` has no separate municipality column — a district is named
 * "<Municipality> <N>" (e.g. "Malapatan 2"), so the municipality is the name
 * with its trailing district number stripped.
 */
export function municipalityOf(districtName: string | null | undefined): string {
  if (!districtName) return "";
  return districtName.replace(/\s*\d+\s*$/, "").trim();
}
