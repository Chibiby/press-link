"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import { resolveSchoolEmail } from "@/lib/auth/resolve-school-email";
import { validateNewSchoolInput, type NewSchoolInput } from "@/lib/schools/validate-new-school";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Moved from `app/admin/(shell)/school-papers/actions.ts` as part of
 * consolidating every account-affecting control onto Users & Access — School
 * Papers keeps a link back here rather than its own copy of this button.
 * Behaviour is unchanged: `admin_unlock_submission` (the RPC) re-checks
 * `admin_profiles` itself, but that is not a reason to skip the check here —
 * a signed-in non-admin gets an honest authorization sentence instead of an
 * opaque database failure, and never reaches the database at all.
 */
export async function unlockSchoolAccountAction(
  schoolId: string
): Promise<{ error: string } | { success: true }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to unlock a school's submission.",
    };
  }
  const supabase = check.supabase;

  const { error } = await supabase.rpc("admin_unlock_submission", {
    target_school: schoolId,
  });
  if (error) {
    console.error("unlockSchoolAccountAction", error);
    return { error: "Could not unlock that school's submission." };
  }

  // School Papers still shows lock state, and /entry is the school's own view
  // of whether it can submit — both are stale the moment this RPC commits.
  revalidatePath("/admin/users");
  revalidatePath("/admin/school-papers");
  revalidatePath("/entry");
  return { success: true as const };
}

/**
 * Creates the login for a school row that exists without one — seeded before
 * `scripts/seed/auth-users.ts` ran, or added by hand outside `createSchoolAccountAction`.
 * Mirrors `seedSchoolAuthUsers`'s per-school body exactly (same email, same
 * password, same `email_confirm: true`), but through a live admin-gated
 * action rather than an offline script, so `createAdminClient()` — a
 * service-role client that bypasses RLS entirely — is never reached without
 * `checkAdmin()` refusing first.
 */
export async function provisionSchoolLoginAction(
  schoolId: string
): Promise<{ error: string } | { success: true }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to provision a school login.",
    };
  }

  const supabase = createAdminClient();

  const { data: school, error: lookupError } = await supabase
    .from("schools")
    .select("id, school_id_number, auth_user_id")
    .eq("id", schoolId)
    .single();

  if (lookupError || !school) {
    console.error("provisionSchoolLoginAction lookup", lookupError);
    return { error: "That school could not be found." };
  }

  // Re-checked here rather than trusted from whatever list the caller read:
  // another admin may have provisioned this same row between page load and
  // this click, and creating a second auth user for one school would orphan
  // the first login's credentials rather than reuse them.
  if (school.auth_user_id) {
    return { error: "This school already has a login." };
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: resolveSchoolEmail(school.school_id_number),
    password: school.school_id_number,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error("provisionSchoolLoginAction createUser", createError);
    return { error: "Could not create a login for that school." };
  }

  const { error: updateError } = await supabase
    .from("schools")
    .update({ auth_user_id: created.user.id })
    .eq("id", schoolId);

  if (updateError) {
    console.error("provisionSchoolLoginAction update", updateError);
    // Undo the createUser above: resolveSchoolEmail is a pure function of
    // school_id_number, so leaving the auth user behind would make every
    // retry — including the one this error message points the admin at —
    // fail forever on Supabase Auth's unique-email constraint.
    const { error: rollbackError } = await supabase.auth.admin.deleteUser(created.user.id);
    if (rollbackError) {
      console.error(
        "provisionSchoolLoginAction rollback failed; orphaned auth user",
        { authUserId: created.user.id, email: created.user.email, rollbackError }
      );
    }
    return { error: "The login was created, but could not be linked to that school." };
  }

  revalidatePath("/admin/users");
  return { success: true as const };
}

/**
 * Adds a school not on the original DepEd roster
 * (`scripts/seed/districts-schools.ts`) and provisions its login in the same
 * action, so a new school is usable immediately rather than left in the
 * unprovisioned state `provisionSchoolLoginAction` exists to repair.
 *
 * `validateNewSchoolInput` owns every rule about what a school row may
 * contain — this function stays thin and only adds what a pure module
 * cannot do: the database round-trips and the "insert succeeded, login
 * didn't" recovery path.
 */
export async function createSchoolAccountAction(
  input: NewSchoolInput
): Promise<{ error: string } | { success: true }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to create a school account.",
    };
  }

  const validated = validateNewSchoolInput(input);
  if ("error" in validated) return validated;
  const { school } = validated;

  const supabase = createAdminClient();

  const { data: inserted, error: insertError } = await supabase
    .from("schools")
    .insert({
      name: school.name,
      school_id_number: school.schoolIdNumber,
      district_id: school.districtId,
      is_integrated: school.isIntegrated,
      level: school.level,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("createSchoolAccountAction insert", insertError);
    // 23505 on schools_school_id_number_key (migration 0001's inline `unique`)
    // is the only constraint an insert can hit here — district_id references
    // districts(id) but isn't itself unique, and auth_user_id is left null on
    // insert. The raw constraint text never reaches the admin either way.
    if (insertError.code === "23505") {
      return { error: "A school with that School ID already exists." };
    }
    return { error: "Could not create that school." };
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: resolveSchoolEmail(school.schoolIdNumber),
    password: school.schoolIdNumber,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error("createSchoolAccountAction createUser", createError);
    // The school row already exists at this point — telling the admin only
    // "something failed" would leave them unable to tell whether to retry
    // the whole form (and hit the school-ID conflict above) or use the
    // repair action that exists for exactly this half-done state. The table
    // behind this dialog needs to know that row exists too, regardless of
    // how the rest of this action ends.
    revalidatePath("/admin/users");
    return {
      error:
        'School was created, but its login could not be provisioned. Use "Provision login" for it.',
    };
  }

  const { error: updateError } = await supabase
    .from("schools")
    .update({ auth_user_id: created.user.id })
    .eq("id", inserted.id);

  if (updateError) {
    console.error("createSchoolAccountAction update", updateError);
    // Undo the createUser above: resolveSchoolEmail is a pure function of
    // school_id_number, so leaving the auth user behind would make every
    // retry via "Provision login" fail forever on a duplicate email.
    const { error: rollbackError } = await supabase.auth.admin.deleteUser(created.user.id);
    if (rollbackError) {
      console.error(
        "createSchoolAccountAction rollback failed; orphaned auth user",
        { authUserId: created.user.id, email: created.user.email, rollbackError }
      );
    }
    revalidatePath("/admin/users");
    return {
      error:
        'School was created, but its login could not be provisioned. Use "Provision login" for it.',
    };
  }

  // /admin's registered-schools count and /admin/schools's roster both read
  // schools fresh, and both changed the moment this row was inserted.
  revalidatePath("/admin/users");
  revalidatePath("/admin/schools");
  revalidatePath("/admin");
  return { success: true as const };
}
