import { isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * What a `supabase.auth.getUser()` result tells us about the visitor, once a
 * transient failure to reach Supabase's auth server is told apart from a
 * definitive "no session".
 *
 * `getUser()` makes a network call, and that call can fail for reasons that
 * have nothing to do with whether the visitor is signed in — a DNS blip, a
 * timeout, a moment of Supabase unavailability. `@supabase/supabase-js`
 * marks exactly this class of failure as `AuthRetryableFetchError`. Treating
 * every failure as "not signed in" (the bug this type exists to prevent)
 * means a perfectly valid session gets bounced to the login page on the next
 * hiccup talking to Supabase — which reads to the admin as "I got logged out
 * for no reason" on an ordinary refresh, or after leaving a tab idle long
 * enough that the access token needed a network round trip to refresh.
 *
 * Only `"unauthenticated"` should ever redirect a visitor off a protected
 * route. `"unverified"` means the check itself did not complete — the caller
 * should let the request through and leave the authoritative decision to the
 * data-access layer (`app/admin/guard.ts`), which is exactly what Next's own
 * Proxy guidance recommends: Proxy performs optimistic checks and "should
 * not be your only line of defense".
 */
export type AuthCheckResult = "authenticated" | "unverified" | "unauthenticated";

export function classifyAuthCheck(user: unknown, error: unknown): AuthCheckResult {
  if (user) return "authenticated";
  if (isAuthRetryableFetchError(error)) return "unverified";
  return "unauthenticated";
}

/**
 * What an `admin_profiles` lookup (by `.eq("user_id", ...).single()`) tells
 * us about the caller, once a query failure is told apart from a genuine
 * zero-row result.
 *
 * `.single()` reports "no row" the same shape — `data: null` — whether the
 * caller truly has no admin profile or the query itself failed (a network
 * blip, a transient PostgREST/RLS hiccup). Only the former is evidence the
 * signed-in account is not an admin; the latter is evidence the check did
 * not complete and must not be treated the same way, because
 * `requireAdmin()` destroys the session (`auth.signOut()`) specifically on
 * "not-admin" — so confusing the two forcibly signs out a genuine admin
 * whose lookup merely failed to run.
 */
export type AdminProfileLookup = "admin" | "not-admin" | "check-failed";

export function classifyAdminProfileLookup(profile: unknown, error: unknown): AdminProfileLookup {
  if (profile) return "admin";
  if (error) return "check-failed";
  return "not-admin";
}

/**
 * What a `judges` lookup (by `.eq("auth_user_id", ...).eq("is_active", true)`
 * with `.maybeSingle()`) tells us about the caller.
 *
 * The same trap as `classifyAdminProfileLookup`: a zero-row result and a
 * failed query arrive in the same shape, and only the first is evidence this
 * account is not a seated judge. `requireJudge()` signs the caller out on
 * "not-judge", so a transient failure must never take that branch.
 *
 * An inactive judge is deliberately indistinguishable from a non-judge here:
 * the row is filtered out by the query, so a withdrawn judge loses access to
 * the portal while their submitted sheets stay on file (see the `judges`
 * table comment in migration 0018).
 */
export type JudgeLookup = "judge" | "not-judge" | "check-failed";

export function classifyJudgeLookup(judge: unknown, error: unknown): JudgeLookup {
  if (judge) return "judge";
  if (error) return "check-failed";
  return "not-judge";
}
