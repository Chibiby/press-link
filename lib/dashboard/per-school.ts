/**
 * The dashboard's per-school panel.
 *
 * `active` is every school with at least one participant, coach or entry —
 * roughly two dozen of the division's 332. The panel renders the top `limit` of
 * them, so three separate numbers matter and are kept separate:
 *
 * - `rows`          what is on screen
 * - `activeSchools` how many schools have any activity at all
 * - `registeredSchools` how many exist
 *
 * `totals` sums `active`, not `rows`. That is the division-wide figure despite
 * the input being filtered: a school with no participants, coaches or entries
 * contributes zero to all three columns, so the filtered sum equals the full
 * sum. The school count is the one figure this does not hold for, which is why
 * it is carried separately rather than derived.
 */
export interface SchoolRollupRow {
  schoolId: string;
  schoolName: string;
  districtName: string;
  learners: number;
  coaches: number;
  entries: number;
}

export interface PerSchoolTotals {
  learners: number;
  coaches: number;
  entries: number;
}

export interface PerSchoolSummary {
  rows: SchoolRollupRow[];
  totals: PerSchoolTotals;
  activeSchools: number;
  registeredSchools: number;
  hiddenSchools: number;
}

export function summarisePerSchool(
  active: SchoolRollupRow[],
  options: { limit: number; registeredSchools: number }
): PerSchoolSummary {
  const totals = active.reduce<PerSchoolTotals>(
    (acc, school) => ({
      learners: acc.learners + school.learners,
      coaches: acc.coaches + school.coaches,
      entries: acc.entries + school.entries,
    }),
    { learners: 0, coaches: 0, entries: 0 }
  );

  // Copy before sorting: this is a view model, and reordering the caller's array
  // would surprise anything that reads it afterwards.
  const ranked = [...active].sort(
    (a, b) =>
      b.entries - a.entries ||
      b.learners - a.learners ||
      a.schoolName.localeCompare(b.schoolName, "en")
  );

  const rows = ranked.slice(0, Math.max(0, options.limit));

  return {
    rows,
    totals,
    activeSchools: active.length,
    registeredSchools: options.registeredSchools,
    hiddenSchools: Math.max(0, active.length - rows.length),
  };
}
