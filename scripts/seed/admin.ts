import { createAdminClient } from "../../lib/supabase/admin";

export async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME ?? "Division Admin";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
  }

  const supabase = createAdminClient();

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !created.user) {
    throw new Error(`Failed to create admin user: ${error?.message}`);
  }

  const { error: profileError } = await supabase
    .from("admin_profiles")
    .insert({ user_id: created.user.id, full_name: fullName });

  if (profileError) {
    throw new Error(`Failed to create admin profile: ${profileError.message}`);
  }

  console.log(`Created admin user ${email}.`);
}
