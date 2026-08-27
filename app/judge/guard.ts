import { redirect } from "next/navigation";

import { classifyAuthCheck, classifyJudgeLookup } from "@/lib/auth/session-check";
import { createClient, type SupabaseServerClient } from "@/lib/supabase/server";

type JudgeCheck =
  | { supabase: SupabaseServerClient; isJudge: true; judgeId: string }
  | { supabase: SupabaseServerClient; isJudge: false; reason: "unauthenticated" | "not-judge" };

/**
 * The single source of truth for "is this caller a seated, active judge".
 * Mirrors `app/admin/guard.ts`: it only reports, because a page wants a
 * redirect and a server action wants an error message.
 *
 * It returns the `judges.id` as well, since every judge-facing RPC is keyed by
 * that rather than by the auth user, and the alternative is every caller
 * repeating this lookup.
 */
export async function checkJudge(): Promise<JudgeCheck> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (classifyAuthCheck(user, userError) !== "authenticated" || !user) {
    return { supabase, isJudge: false, reason: "unauthenticated" };
  }

  const { data: judge, error: judgeError } = await supabase
    .from("judges")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  const lookup = classifyJudgeLookup(judge, judgeError);
  if (lookup === "not-judge") return { supabase, isJudge: false, reason: "not-judge" };
  // "check-failed": the query didn't complete, which is not evidence this
  // account isn't a judge — so it must not take the branch requireJudge()
  // destroys the session for.
  if (lookup === "check-failed") return { supabase, isJudge: false, reason: "unauthenticated" };

  return { supabase, isJudge: true, judgeId: judge!.id };
}

/**
 * Page-shaped guard: every judge page starts with this. A signed-in non-judge
 * is signed out as well as bounced, so no half-valid session survives a visit
 * to a judge URL.
 */
export async function requireJudge(): Promise<{ supabase: SupabaseServerClient; judgeId: string }> {
  const check = await checkJudge();
  if (!check.isJudge) {
    if (check.reason === "not-judge") await check.supabase.auth.signOut();
    redirect("/judge/login");
  }

  return { supabase: check.supabase, judgeId: check.judgeId };
}
