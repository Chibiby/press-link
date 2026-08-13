export interface RawSchoolRow {
  schoolId: string | number | undefined;
  schoolName: string | undefined;
  district: string | undefined;
}

export interface NormalizedSchool {
  schoolIdNumber: string;
  schoolName: string;
  districtName: string;
}

export interface TransformResult {
  districtNames: string[];
  schools: NormalizedSchool[];
  /** Rows dropped because their school_id_number repeats an earlier row's — e.g. an
   * "Extension" satellite campus sharing its parent school's official School ID. Since
   * school_id_number is this app's unique login credential, only the first (parent) row
   * is kept; duplicates are surfaced here so seeding can log what got dropped instead of
   * silently discarding schools. */
  droppedDuplicates: NormalizedSchool[];
}

export function transformSchoolRows(rows: RawSchoolRow[]): TransformResult {
  const schools: NormalizedSchool[] = [];
  const droppedDuplicates: NormalizedSchool[] = [];
  const districtSet = new Set<string>();
  const seenSchoolIds = new Set<string>();

  for (const row of rows) {
    const schoolIdNumber = String(row.schoolId ?? "").trim();
    const schoolName = String(row.schoolName ?? "").trim();
    const districtName = String(row.district ?? "").trim();

    if (!schoolIdNumber || !schoolName || !districtName) {
      continue;
    }

    const school = { schoolIdNumber, schoolName, districtName };

    if (seenSchoolIds.has(schoolIdNumber)) {
      droppedDuplicates.push(school);
      continue;
    }
    seenSchoolIds.add(schoolIdNumber);

    districtSet.add(districtName);
    schools.push(school);
  }

  return {
    districtNames: Array.from(districtSet).sort(),
    schools,
    droppedDuplicates,
  };
}
