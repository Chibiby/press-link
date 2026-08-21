import { redirect } from "next/navigation";

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
  } = await supabase.auth.getUser();
  if (!user) return { supabase, isAdmin: false, reason: "unauthenticated" };

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .single();
  if (!profile) return { supabase, isAdmin: false, reason: "not-admin" };

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
