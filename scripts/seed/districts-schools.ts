import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { createAdminClient } from "../../lib/supabase/admin";
import { transformSchoolRows, type RawSchoolRow } from "./districts-schools.transform";

export async function seedDistrictsAndSchools() {
  const filePath = process.env.SCHOOL_HEADS_XLSX_PATH;
  if (!filePath) {
    throw new Error("SCHOOL_HEADS_XLSX_PATH is not set");
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Row 0 is the checklist title, row 1 is the real header row; data starts at row 2.
  const rows: RawSchoolRow[] = rawRows.slice(2).map((row) => ({
    schoolId: row[1] as string | number | undefined,
    schoolName: row[2] as string | undefined,
    district: row[3] as string | undefined,
  }));

  const { districtNames, schools, skipped } = transformSchoolRows(rows);

  if (skipped.length > 0) {
    console.warn(`Skipped ${skipped.length} row(s) with an unusable school_id_number:`);
    for (const s of skipped) {
      console.warn(`  - ${s.schoolName} (${s.districtName}, id "${s.rawSchoolId}") — ${s.reason}`);
    }
  }

  const supabase = createAdminClient();

  const { data: insertedDistricts, error: districtError } = await supabase
    .from("districts")
    .upsert(
      districtNames.map((name) => ({ name })),
      { onConflict: "name" }
    )
    .select("id, name");

  if (districtError || !insertedDistricts) {
    throw new Error(`Failed to seed districts: ${districtError?.message}`);
  }

  const districtIdByName = new Map(insertedDistricts.map((d) => [d.name, d.id]));

  const { error: schoolError } = await supabase.from("schools").upsert(
    // Note that re-running the seeder rewrites `is_integrated` from the name, the same
    // way it rewrites the name and the district. A hand-correction the division office
    // made to a school the name test misses will not survive a re-seed; that is the
    // existing behaviour of this upsert, not something new to this column.
    schools.map((s) => ({
      name: s.schoolName,
      school_id_number: s.schoolIdNumber,
      district_id: districtIdByName.get(s.districtName),
      is_integrated: s.isIntegrated,
    })),
    { onConflict: "school_id_number" }
  );

  if (schoolError) {
    throw new Error(`Failed to seed schools: ${schoolError.message}`);
  }

  console.log(`Seeded ${districtNames.length} districts and ${schools.length} schools.`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  seedDistrictsAndSchools().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
