/**
 * The five ways an officer asks "which schools?". Kept as a closed union rather than a
 * free-text query param so a mistyped URL cannot produce a table nobody can explain.
 */
export type SchoolStatus = "all" | "learners-no-entry" | "no-data" | "entered" | "locked";

const STATUSES: SchoolStatus[] = ["all", "learners-no-entry", "no-data", "entered", "locked"];

export const SCHOOL_STATUS_LABEL: Record<SchoolStatus, string> = {
  all: "All schools",
  "learners-no-entry": "Has learners, no entry",
  "no-data": "Nothing on record",
  entered: "Has entries",
  locked: "Submission locked",
};

export function isSchoolStatus(value: string | undefined): value is SchoolStatus {
  return value !== undefined && (STATUSES as string[]).includes(value);
}

/** One school as the registry table prints it. */
export interface RegistryRow {
  schoolId: string;
  schoolName: string;
  /** `schools.school_id_number` — the division's own identifier, unique and text. */
  schoolIdNumber: string;
  districtId: string;
  districtName: string;
  learners: number;
  coaches: number;
  entries: number;
  lockedAt: string | null;
}

export interface RegistrySummary {
  rows: RegistryRow[];
  /** Rows after both filters — what the table shows. */
  shown: number;
  /** Rows after the district filter only — the honest denominator for "N of M". */
  registered: number;
  /** Column sums over the shown rows. */
  totals: { learners: number; coaches: number; entries: number };
}

function matches(row: RegistryRow, status: SchoolStatus): boolean {
  switch (status) {
    case "all":
      return true;
    // Identical to `schoolsWithLearnersButNoEntry` in lib/dashboard/school-facts.ts:
    // `rows.filter((row) => row.learners > 0 && row.entries === 0)`. The dashboard's
    // attention row links here with this status, and its badge is that count — so the
    // two predicates are one predicate or the page contradicts the dashboard.
    case "learners-no-entry":
      return row.learners > 0 && row.entries === 0;
    case "no-data":
      return row.learners === 0 && row.coaches === 0 && row.entries === 0;
    case "entered":
      return row.entries > 0;
    case "locked":
      return row.lockedAt !== null;
  }
}

/**
 * Filters the registry and sums what survives.
 *
 * The two filters are deliberately asymmetric. District narrows the *population*, so it
 * moves `registered`; status narrows the *view*, so it does not. That is what lets the
 * footer say "6 of 18 schools in Alabel" — a sentence neither number alone can make.
 *
 * Order is never touched: the query orders by name, and a module that re-sorted would give
 * this page a different sequence from every other school list in the admin area.
 */
export function summariseRegistry(
  rows: RegistryRow[],
  options: { status: SchoolStatus; districtId: string | null }
): RegistrySummary {
  const inDistrict = options.districtId
    ? rows.filter((row) => row.districtId === options.districtId)
    : rows;

  const shown = inDistrict.filter((row) => matches(row, options.status));

  return {
    rows: shown,
    shown: shown.length,
    registered: inDistrict.length,
    totals: {
      learners: shown.reduce((sum, row) => sum + row.learners, 0),
      coaches: shown.reduce((sum, row) => sum + row.coaches, 0),
      entries: shown.reduce((sum, row) => sum + row.entries, 0),
    },
  };
}
