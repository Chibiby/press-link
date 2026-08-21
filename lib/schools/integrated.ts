/**
 * Which schools run both elementary and secondary under one roof.
 *
 * The division roll carries no level column and no register of integrated
 * schools, so the name is the only signal there is: "Banlibato Integrated
 * School", "Alabel Integrated SPED Center".
 *
 * This function is the application's copy of the rule that
 * `supabase/migrations/0016_integrated_schools.sql` applies in SQL. The two must
 * agree, and `integrated.test.ts` is what holds them together — the migration
 * uses `name ~* '\yintegrated\y'` and this uses `/\bintegrated\b/i`, which are
 * the same predicate spelled for two engines.
 *
 * Word boundaries, not a bare substring: `%integrated%` also matches
 * "Reintegrated", and there is no reason to accept a false positive that costs
 * nothing to exclude.
 *
 * Note what this is *for*. `schools.is_integrated` is a stored, correctable
 * column; this helper seeds and audits it. Runtime code should read the column
 * and never re-derive from the name, so a hand-correction by the division
 * office is not silently overruled on every page load.
 *
 * That correction survives normal use, but **not a re-seed**:
 * `scripts/seed/districts-schools.ts` upserts on `school_id_number` and rewrites
 * `is_integrated` from the name, exactly as it already rewrites `name` and
 * `district_id`. A school the name test gets wrong therefore needs correcting
 * again after any seed run. Making the column insert-only in the seeder is the
 * durable fix and is deliberately not done here.
 */
const INTEGRATED = /\bintegrated\b/i;

export function isIntegratedName(name: string | null | undefined): boolean {
  if (!name) return false;
  return INTEGRATED.test(name);
}
