import { isIntegratedName } from "../../lib/schools/integrated";
import { inferSchoolLevel, type SchoolLevel } from "../../lib/schools/level";

export interface RawSchoolRow {
  schoolId: string | number | undefined;
  schoolName: string | undefined;
  district: string | undefined;
}

export interface NormalizedSchool {
  schoolIdNumber: string;
  schoolName: string;
  districtName: string;
  /** Runs elementary and secondary under this one school id, and so files two school
   * papers per language instead of one. The division roll carries no level column, so the
   * name is the only signal there is — see `lib/schools/integrated.ts`. Seeding it here is
   * what makes a fresh environment agree with what migration 0016 backfills in an existing
   * one; after that the column is the truth and the office may correct it by hand. */
  isIntegrated: boolean;
  /** Elementary or secondary, for a non-integrated school only — see `lib/schools/level.ts`.
   * An integrated school teaches both, so no single level describes it and this is always
   * `null` for one regardless of what its name says; that mirrors how the migration's own
   * backfill (0026) excludes integrated schools rather than guessing at them. Seeding it here
   * is what makes a fresh environment agree with what 0026 backfills in an existing one. */
  level: SchoolLevel | null;
}

export interface SkippedRow {
  schoolName: string;
  districtName: string;
  rawSchoolId: string;
  reason: "duplicate-school-id" | "non-numeric-school-id";
}

export interface TransformResult {
  districtNames: string[];
  schools: NormalizedSchool[];
  /** Rows skipped either because their school_id_number repeats an earlier row's — e.g. an
   * "Extension" satellite campus sharing its parent school's official School ID — or because
   * the source spreadsheet has a placeholder like "No School ID yet" instead of a real ID.
   * Since school_id_number is this app's unique login credential and gets embedded in a
   * synthetic email address, only real numeric IDs are usable; skipped rows are surfaced
   * here so seeding can log what got dropped instead of silently discarding schools. */
  skipped: SkippedRow[];
}

const NUMERIC_ID_PATTERN = /^\d+$/;

export function transformSchoolRows(rows: RawSchoolRow[]): TransformResult {
  const schools: NormalizedSchool[] = [];
  const skipped: SkippedRow[] = [];
  const districtSet = new Set<string>();
  const seenSchoolIds = new Set<string>();

  for (const row of rows) {
    const schoolIdNumber = String(row.schoolId ?? "").trim();
    const schoolName = String(row.schoolName ?? "").trim();
    const districtName = String(row.district ?? "").trim();

    if (!schoolIdNumber || !schoolName || !districtName) {
      continue;
    }

    if (!NUMERIC_ID_PATTERN.test(schoolIdNumber)) {
      skipped.push({ schoolName, districtName, rawSchoolId: schoolIdNumber, reason: "non-numeric-school-id" });
      continue;
    }

    if (seenSchoolIds.has(schoolIdNumber)) {
      skipped.push({ schoolName, districtName, rawSchoolId: schoolIdNumber, reason: "duplicate-school-id" });
      continue;
    }
    seenSchoolIds.add(schoolIdNumber);

    districtSet.add(districtName);
    const integrated = isIntegratedName(schoolName);
    schools.push({
      schoolIdNumber,
      schoolName,
      districtName,
      isIntegrated: integrated,
      level: integrated ? null : inferSchoolLevel(schoolName),
    });
  }

  return {
    districtNames: Array.from(districtSet).sort(),
    schools,
    skipped,
  };
}
