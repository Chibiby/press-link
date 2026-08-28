"use server";

import { revalidatePath } from "next/cache";

import { checkAdmin } from "@/app/admin/guard";
import { submissionLockMessage } from "@/lib/submissions/lock-errors";
import { validateGrantInput, type RevisionSurface } from "@/lib/submissions/revision-grant";

export type RevisionGrantResult = { error: string } | { success: true };

/**
 * The sentence the partial unique index produces, in the reader's words.
 *
 * `revision_grants_one_live` from 0031 is a real guard rather than a formality:
 * two admins clicking Allow revision on the same school inside one another's
 * transaction both pass the "revoke anything live" step, because neither can see
 * the other's uncommitted row, and the second insert then fails with 23505. That
 * is the only outcome of this action the admin's own screen is already wrong
 * about, so the copy says what to do about it rather than what went wrong.
 */
const RACE_MESSAGE =
  "Another administrator just granted revision to this school. Reload the page to see it.";

/**
 * Reopens one school, on the surfaces named, for a fixed number of minutes,
 * while the division-wide lock stays exactly where it is.
 *
 * Thin for `setSubmissionsLockAction`'s reason: `admin_grant_revision` in
 * migration 0031 owns every rule worth having. It re-checks `admin_profiles`
 * itself (RLS does not apply inside a `security definer` function, so the read
 * policies on `revision_grants` are never consulted, and there is no write policy
 * for them to consult), it clamps `p_minutes` to 1..1440, it refuses an empty
 * scope with a sentence, and it revokes the school's previous grant rather than
 * updating it — so `Change` keeps the record of what was granted at 3:49 when the
 * office extends it at 4:05. Nothing it does touches `schools` or `app_settings`.
 *
 * The admin check is repeated here anyway, following
 * `app/admin/(shell)/submissions-lock-actions.ts`: a signed-in non-admin gets an
 * honest authorization sentence instead of an opaque database failure, and never
 * reaches the database at all.
 */
export async function allowRevisionAction(
  schoolId: string,
  surfaces: unknown,
  minutes: unknown,
): Promise<RevisionGrantResult> {
  // A Server Action is a public POST endpoint, so every argument is untrusted
  // even though the only caller is a dialog with three checkboxes and a select.
  // The school id is checked here rather than by `validateGrantInput`, which is
  // shared with nothing that knows about schools; the RPC raises 'school not
  // found' for a uuid that no longer exists, and this stops the shapes that would
  // otherwise be coerced into one by PostgREST on the way there.
  if (typeof schoolId !== "string" || !schoolId) {
    return { error: "No school was sent. Try the button again." };
  }

  // Returned unchanged rather than reworded. `validateGrantInput` orders its two
  // errors to match the dialog's own controls — checkboxes above duration — so
  // the first thing an admin is told names the first control their eye reaches,
  // and rewording it here would put that ordering in two places.
  const input = validateGrantInput({ surfaces, minutes });
  if ("error" in input) return input;

  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to grant a school revision.",
    };
  }

  // The `p_` prefixes are load-bearing and they are not what the design document
  // wrote. `returns table` makes each output column a parameter too and Postgres
  // refuses a name used twice, so 0031 kept the table's names on the output and
  // prefixed the inputs; PostgREST calls an RPC by argument name, so these five
  // keys have to be spelled exactly as section 9 of the migration declares them.
  //
  // Surfaces are turned into three booleans here rather than sent as a list,
  // because three boolean columns is what the table has. `validateGrantInput`
  // filtered them out of `REVISION_SURFACES`, so each `includes` is over a value
  // that provably came from the tuple.
  const granted: RevisionSurface[] = input.surfaces;

  // `.single()` because PostgREST returns a set-returning function as an array,
  // so this is a one-row set rather than a scalar read. The row itself is
  // discarded: the page re-reads the table on the revalidate below, and a second
  // opinion about what was just written is a second thing that can disagree.
  const { error } = await check.supabase
    .rpc("admin_grant_revision", {
      target_school: schoolId,
      p_allow_paper: granted.includes("paper"),
      p_allow_roster: granted.includes("roster"),
      p_allow_entries: granted.includes("entries"),
      p_minutes: input.minutes,
    })
    .single<{
      id: string;
      school_id: string;
      granted_at: string;
      granted_by: string | null;
      expires_at: string;
      revoked_at: string | null;
      allow_paper: boolean;
      allow_roster: boolean;
      allow_entries: boolean;
    }>();

  if (error) {
    console.error("allowRevisionAction", error);

    // Checked before the shared classifier, because this one is not a lock
    // refusal at all — it is the race `revision_grants_one_live` exists for, and
    // it is the only failure here where the admin's screen is out of date rather
    // than their request wrong.
    if (error.code === "23505") {
      return { error: RACE_MESSAGE };
    }

    // The database's own words carry the fallback, exactly as the division-wide
    // switch does. Until 0031 is applied this call fails with "Could not find the
    // function public.admin_grant_revision", and that sentence is the only thing
    // that identifies why — a generic "something went wrong" would leave an admin
    // re-clicking a button that cannot work on this environment yet.
    return {
      error: submissionLockMessage(
        error,
        `Could not grant revision to that school: ${error.message}`,
      ),
    };
  }

  // The admin table renders the grant, its expiry and the three controls around
  // it. /entry is the school's own view of what it may now write, and it is stale
  // the instant this RPC commits — which is the half that matters, because the
  // window is short and a school looking at a cached "submissions are closed"
  // banner spends it doing nothing.
  revalidatePath("/admin/users");
  revalidatePath("/entry");

  return { success: true as const };
}

/**
 * Closes a school's window early.
 *
 * `admin_revoke_revision` is idempotent by construction, and this action
 * deliberately adds no "is there a grant to revoke" pre-check in front of it.
 * The admin page is a server-rendered list that can be seconds out of date: the
 * grant may have expired on its own, or another admin may have revoked it,
 * between the render and the click. A pre-check would read a different row than
 * the `update ... where revoked_at is null` does and could disagree with it, and
 * the disagreement would be reported to an admin whose only remedy is the refresh
 * that was going to happen anyway. The end state is identical either way.
 */
export async function revokeRevisionAction(
  schoolId: string,
): Promise<RevisionGrantResult> {
  if (typeof schoolId !== "string" || !schoolId) {
    return { error: "No school was sent. Try the button again." };
  }

  const check = await checkAdmin();
  if (!check.isAdmin) {
    return {
      error:
        check.reason === "unauthenticated"
          ? "Not authenticated."
          : "You are not authorized to withdraw a school's revision.",
    };
  }

  // No `.single()`: `admin_revoke_revision` is `returns void`, deliberately
  // rather than a row count — a count invites the caller to treat 0 as failure,
  // which is precisely the behaviour the idempotence above rules out.
  const { error } = await check.supabase.rpc("admin_revoke_revision", {
    target_school: schoolId,
  });

  if (error) {
    console.error("revokeRevisionAction", error);
    return {
      error: submissionLockMessage(
        error,
        `Could not withdraw that school's revision: ${error.message}`,
      ),
    };
  }

  // Both for the same reason as the grant: the school may be typing into the
  // window this just closed, and its page has to stop presenting the forms as
  // writable before it finds out from a failed save.
  revalidatePath("/admin/users");
  revalidatePath("/entry");

  return { success: true as const };
}
