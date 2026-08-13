import { createAdminClient } from "../../lib/supabase/admin";
import { resolveSchoolEmail } from "../../lib/auth/resolve-school-email";

export async function seedSchoolAuthUsers() {
  const supabase = createAdminClient();

  const { data: schools, error } = await supabase
    .from("schools")
    .select("id, school_id_number, auth_user_id")
    .is("auth_user_id", null);

  if (error) {
    throw new Error(`Failed to load schools: ${error.message}`);
  }

  for (const school of schools ?? []) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: resolveSchoolEmail(school.school_id_number),
      password: school.school_id_number,
      email_confirm: true,
    });

    if (createError || !created.user) {
      throw new Error(`Failed to create auth user for school ${school.id}: ${createError?.message}`);
    }

    const { error: updateError } = await supabase
      .from("schools")
      .update({ auth_user_id: created.user.id })
      .eq("id", school.id);

    if (updateError) {
      throw new Error(`Failed to link auth user for school ${school.id}: ${updateError.message}`);
    }
  }

  console.log(`Created auth users for ${schools?.length ?? 0} schools.`);
}
