/**
 * Which level a *non-integrated* school teaches: elementary or secondary.
 *
 * The division roll carries no level column, so — same as `is_integrated`
 * (`lib/schools/integrated.ts`) — the name is the only signal there is:
 * "Malapatan Central Elementary School", "Alabel National High School".
 *
 * This function is the application's copy of the rule that
 * `supabase/migrations/0026_school_level.sql` applies in SQL. The two must
 * agree, and `level.test.ts` is what holds them together — the migration uses
 * `~*` with `\y` (Postgres's word boundary) and this uses `\b` (JS's word
 * boundary), which are the same predicate spelled for two engines.
 *
 * Elementary is checked first: a name that somehow matches both patterns is
 * classified as elementary rather than secondary, the same conservative bias
 * `is_integrated` uses for its own false-positive risk. A name that matches
 * neither returns `null` — "not yet classified" — rather than a guess.
 *
 * This is deliberately *not* asked of an integrated school. An integrated
 * school teaches both levels under one school id, so no single level
 * describes it; its papers carry their own level per row instead
 * (`school_papers.level`, 0016). Callers must not call this for one — check
 * `is_integrated` first, exactly as the migration's backfill does.
 *
 * Note what this is *for*, same caveat as `is_integrated`:
 * `schools.level` is a stored, correctable column; this helper seeds and
 * audits it. Runtime code should read the column and never re-derive from the
 * name, so a hand-correction by the division office is not silently
 * overruled on every page load.
 */
export type SchoolLevel = "elementary" | "secondary";

const ELEMENTARY = /\belementary\b/i;
const SECONDARY_PHRASE = /\b(national high school|high school)\b/i;
const SECONDARY_TRAILING = /\b(nhs|hs)\b$/i;

export function inferSchoolLevel(name: string | null | undefined): SchoolLevel | null {
  if (!name) return null;
  if (ELEMENTARY.test(name)) return "elementary";
  if (SECONDARY_PHRASE.test(name) || SECONDARY_TRAILING.test(name)) return "secondary";
  return null;
}
