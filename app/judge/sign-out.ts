"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/** The mirror of `adminSignOutAction`, landing on the judge's own sign-in page. */
export async function judgeSignOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/judge/login");
}
