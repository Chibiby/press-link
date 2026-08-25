import { isIntegratedName } from "./integrated";
import { inferSchoolLevel, type SchoolLevel } from "./level";

/**
 * The raw, untrusted fields `createSchoolAccountAction`
 * (`app/admin/(shell)/users/actions.ts`) receives from the "add school" form.
 */
export interface NewSchoolInput {
  name: string;
  districtId: string;
  schoolIdNumber: string;
}

/**
 * A trimmed, checked input plus the two columns the seeder derives rather than
 * lets an admin type — `is_integrated` from {@link isIntegratedName} and `level`
 * from {@link inferSchoolLevel}, `null` for an integrated school. Same rule
 * `scripts/seed/districts-schools.transform.ts` applies to every roster row, so
 * a hand-created school agrees with a seeded one instead of needing a
 * correction pass the moment it is entered.
 */
export interface ValidatedNewSchool {
  name: string;
  districtId: string;
  schoolIdNumber: string;
  isIntegrated: boolean;
  level: SchoolLevel | null;
}

export type NewSchoolValidationResult =
  | { error: string }
  | { school: ValidatedNewSchool };

/**
 * Same predicate as `NUMERIC_ID_PATTERN` in
 * `scripts/seed/districts-schools.transform.ts` (not exported from there, so
 * restated here rather than imported) — `school_id_number` is embedded in a
 * synthetic login email and doubles as the login password, so anything the
 * seeder would skip as unusable must be refused here too.
 */
const NUMERIC_ID_PATTERN = /^\d+$/;

/**
 * Trims and checks a new-school form submission, or explains the first
 * problem found.
 *
 * Order mirrors the fields as they appear in the form: name, district, then
 * school ID, so the first error an admin sees is also the first blank field
 * their eye would reach.
 */
export function validateNewSchoolInput(
  input: NewSchoolInput
): NewSchoolValidationResult {
  const name = input.name.trim();
  const districtId = input.districtId.trim();
  const schoolIdNumber = input.schoolIdNumber.trim();

  if (!name) return { error: "School name is required." };
  if (!districtId) return { error: "District is required." };
  if (!schoolIdNumber) return { error: "School ID is required." };
  if (!NUMERIC_ID_PATTERN.test(schoolIdNumber)) {
    return { error: "School ID must contain digits only." };
  }

  const isIntegrated = isIntegratedName(name);
  return {
    school: {
      name,
      districtId,
      schoolIdNumber,
      isIntegrated,
      level: isIntegrated ? null : inferSchoolLevel(name),
    },
  };
}
