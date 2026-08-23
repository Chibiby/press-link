"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import { submissionLockMessage } from "@/lib/submissions/lock-errors";

export type SubmissionsLockResult =
  | { error: string }
  | { success: true; locked: boolean };

/**
 * Flips the division-wide submissions switch.
 *
 * Thin on purpose: `admin_set_submissions_lock` in migration 0022 owns every rule
 * worth having. It re-checks `admin_profiles` itself (RLS does not apply inside a
 * `security definer` function, so its update policy is never consulted), it keeps
 * the first stamp when the lock is re-applied, and it writes nothing to `schools`
 * — which is what makes unlocking put every school back exactly where it was.
 *
 * The admin check is repeated here anyway, following
 * `app/admin/(shell)/school-papers/actions.ts`: a signed-in non-admin gets an
 * honest authorization sentence instead of an opaque database failure, and never
 * reaches the database at all.
 */
export async function setSubmissionsLockAction(
  locked: boolean,
): Promise<SubmissionsLockResult> {
  // A Server Action is a public POST endpoint, so the argument is untrusted even
  // though the only caller is a two-state button. The RPC raises 'locked is
  // required' for null; anything non-boolean is stopped before it can be coerced
  // into one by PostgREST.
  if (typeof locked !== "boolean") {
    return { error: "No lock state was sent. Try the switch again." };
  }

  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to change the division-wide submission lock.",
    };
  }

  // PostgREST returns a set-returning function as an array, so this is `.single()`
  // over a one-row set rather than a scalar read.
  const { data, error } = await check.supabase
    .rpc("admin_set_submissions_lock", { locked })
    .single<{
      submissions_locked: boolean;
      submissions_locked_at: string | null;
      submissions_locked_by: string | null;
    }>();

  if (error) {
    console.error("setSubmissionsLockAction", error);
    // The database's own words carry the fallback. Until 0022 is applied this
    // call fails with "Could not find the function
    // public.admin_set_submissions_lock", and that sentence is the only thing
    // that identifies why — a generic "something went wrong" would leave an
    // admin re-clicking a button that cannot work yet.
    return {
      error: submissionLockMessage(
        error,
        `Could not ${locked ? "lock" : "unlock"} submissions division-wide: ${error.message}`,
      ),
    };
  }

  // The dashboard reads the flag and derives its status pill from it. /entry
  // renders per-school, not from this flag, but its writes are now refused
  // division-wide, so its cached view of what a school may edit is stale too.
  revalidatePath("/admin");
  revalidatePath("/entry");

  return { success: true as const, locked: data.submissions_locked };
}
