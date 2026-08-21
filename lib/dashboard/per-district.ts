import type { RegistryRow } from "./school-registry";

/** One district's schools, added up. */
export interface DistrictRollup {
  districtId: string;
  districtName: string;
  /** Schools on the division roll in this district, whether or not they have data. */
  schools: number;
  /** Schools with at least one learner, coach or entry — the same test `active` uses. */
  schoolsWithData: number;
  schoolsWithEntries: number;
  learners: number;
  coaches: number;
  entries: number;
}

export interface PerDistrictSummary {
  rows: DistrictRollup[];
  /**
   * Districts holding at least one school with an entry. Equal to
   * `SchoolFacts.districtsWithEntries`, which is the dashboard KPI's numerator — the two
   * are computed from the same query, and the test above pins them together.
   */
  districtsWithEntries: number;
  totals: {
    schools: number;
    schoolsWithData: number;
    schoolsWithEntries: number;
    learners: number;
    coaches: number;
    entries: number;
  };
}

/**
 * Folds school rows into one rollup per district.
 *
 * `districts` drives the output, not `rows`: a district with no schools must still get a
 * row, and the order must match the `districts` query's name ordering so this table and the
 * filter dropdown on /admin/schools read in the same sequence.
 *
 * A school whose district id is not in `districts` is skipped. The foreign key makes that
 * impossible in production; skipping rather than creating a phantom district row means a
 * broken key shows up as a total that is too small, which is visible, instead of a row
 * labelled "undefined", which is not.
 */
export function summarisePerDistrict(
  districts: { id: string; name: string }[],
  rows: RegistryRow[]
): PerDistrictSummary {
  const byId = new Map<string, DistrictRollup>(
    districts.map((district) => [
      district.id,
      {
        districtId: district.id,
        districtName: district.name,
        schools: 0,
        schoolsWithData: 0,
        schoolsWithEntries: 0,
        learners: 0,
        coaches: 0,
        entries: 0,
      },
    ])
  );

  for (const row of rows) {
    const rollup = byId.get(row.districtId);
    if (!rollup) continue;

    rollup.schools += 1;
    if (row.learners > 0 || row.coaches > 0 || row.entries > 0) rollup.schoolsWithData += 1;
    if (row.entries > 0) rollup.schoolsWithEntries += 1;
    rollup.learners += row.learners;
    rollup.coaches += row.coaches;
    rollup.entries += row.entries;
  }

  const result = [...byId.values()];

  return {
    rows: result,
    districtsWithEntries: result.filter((row) => row.schoolsWithEntries > 0).length,
    totals: {
      schools: result.reduce((sum, row) => sum + row.schools, 0),
      schoolsWithData: result.reduce((sum, row) => sum + row.schoolsWithData, 0),
      schoolsWithEntries: result.reduce((sum, row) => sum + row.schoolsWithEntries, 0),
      learners: result.reduce((sum, row) => sum + row.learners, 0),
      coaches: result.reduce((sum, row) => sum + row.coaches, 0),
      entries: result.reduce((sum, row) => sum + row.entries, 0),
    },
  };
}
