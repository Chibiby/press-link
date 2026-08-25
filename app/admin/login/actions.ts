"use server";

import { redirect } from "next/navigation";
import { classifyAdminProfileLookup } from "@/lib/auth/session-check";
import { createClient } from "@/lib/supabase/server";

export async function adminLoginAction(formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Invalid email or password." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", data.user.id)
    .single();

  const lookup = classifyAdminProfileLookup(profile, profileError);
  if (lookup === "not-admin") {
    await supabase.auth.signOut();
    return { error: "This account is not an admin account." };
  }
  if (lookup === "check-failed") {
    // The query itself didn't complete — not evidence this account isn't an
    // admin. Leave the session as sign-in just created it and ask the caller
    // to try again, rather than telling a genuine admin they're not one.
    return { error: "Could not verify admin access. Please try again." };
  }

  redirect("/admin");
}
