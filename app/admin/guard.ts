import { redirect } from "next/navigation";

import { classifyAdminProfileLookup, classifyAuthCheck } from "@/lib/auth/session-check";
import { createClient, type SupabaseServerClient } from "@/lib/supabase/server";

type AdminCheck =
  | { supabase: SupabaseServerClient; isAdmin: true }
  | { supabase: SupabaseServerClient; isAdmin: false; reason: "unauthenticated" | "not-admin" };

/**
 * The single source of truth for "is this caller a division admin". It only
 * reports; deciding what to do about a refusal is left to the caller, because
 * a page wants a redirect and a server action wants an error message.
 */
export async function checkAdmin(): Promise<AdminCheck> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (classifyAuthCheck(user, userError) !== "authenticated" || !user) {
    return { supabase, isAdmin: false, reason: "unauthenticated" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  const lookup = classifyAdminProfileLookup(profile, profileError);
  if (lookup === "not-admin") return { supabase, isAdmin: false, reason: "not-admin" };
  // "check-failed": the query itself didn't complete (a network blip, a
  // transient PostgREST/RLS hiccup) — that is not evidence this signed-in
  // account isn't an admin, so it must not take the "not-admin" branch,
  // which is the one requireAdmin() destroys the session for.
  if (lookup === "check-failed") return { supabase, isAdmin: false, reason: "unauthenticated" };

  return { supabase, isAdmin: true };
}

/**
 * Page-shaped guard: every admin page starts with this. A signed-in non-admin
 * is signed out as well as bounced, so no half-valid session survives a visit
 * to an admin URL.
 */
export async function requireAdmin(): Promise<{ supabase: SupabaseServerClient }> {
  const check = await checkAdmin();
  if (!check.isAdmin) {
    if (check.reason === "not-admin") await check.supabase.auth.signOut();
    redirect("/admin/login");
  }

  return { supabase: check.supabase };
}
