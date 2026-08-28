import { cache } from "react";
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
 *
 * Wrapped in React's cache() because it is *two network round trips* — an
 * auth.getUser() against Supabase's auth server and an admin_profiles select —
 * and one admin navigation used to run the whole thing twice. The page asks
 * through its own loader; the shell layout asks again through loadAdminName().
 * Those two render concurrently, so the duplicate never showed up as a pause
 * and was plainly there in the logs: a single request for /admin/judges
 * produced two getUser() calls and two admin_profiles selects. Four round
 * trips to answer one question is not a rounding error when the deployment and
 * the database are on different continents.
 *
 * Nothing about how strict the check is changes. cache() memoises for the
 * lifetime of one server request and nothing longer — a different request, a
 * different visitor, or the same visitor a moment later each re-run it in
 * full, auth server and profile row included. It is the tool dashboard-data.ts
 * already reaches for in getAdminClient(); moving it down here is what lets
 * the loaders that call requireAdmin() directly — judging-data.ts among them —
 * share that one answer instead of buying their own.
 *
 * It is also not a hole in requireAdmin()'s sign-out: a caller that re-asks
 * inside the same request gets the memoised "not-admin" and is refused on it,
 * which is the answer that decides the request either way.
 */
export const checkAdmin = cache(async (): Promise<AdminCheck> => {
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
});

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
