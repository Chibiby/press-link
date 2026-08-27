"use server";

import { redirect } from "next/navigation";

import { classifyJudgeLookup } from "@/lib/auth/session-check";
import { createClient } from "@/lib/supabase/server";

/**
 * Judge sign-in, the mirror of `app/admin/login/actions.ts`.
 *
 * The `judges` lookup runs after the password, not instead of it: a wrong
 * password and a non-judge account must be told apart here, because the second
 * needs the session destroyed and the first never created one.
 *
 * An inactive judge is refused with the same sentence as a non-judge. The query
 * filters `is_active`, so the two arrive identically — and that is deliberate:
 * a withdrawn judge loses the portal while their submitted sheets stay on file,
 * and the portal is not the place to explain a withdrawal.
 */
export async function judgeLoginAction(formData: FormData): Promise<{ error: string } | void> {
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

  const { data: judge, error: judgeError } = await supabase
    .from("judges")
    .select("id")
    .eq("auth_user_id", data.user.id)
    .eq("is_active", true)
    .maybeSingle();

  const lookup = classifyJudgeLookup(judge, judgeError);
  if (lookup === "not-judge") {
    await supabase.auth.signOut();
    return { error: "This account is not a judge account." };
  }
  if (lookup === "check-failed") {
    // The query itself didn't complete — that is not evidence this account is
    // not a judge. The session stands as sign-in just created it, and the judge
    // is asked to try again rather than told they are not one.
    return { error: "Could not verify judge access. Please try again." };
  }

  redirect("/judge");
}
