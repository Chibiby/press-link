import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { classifyAdminProfileLookup, classifyAuthCheck, classifyJudgeLookup } from "./session-check";

describe("classifyAuthCheck", () => {
  it("is authenticated when getUser() returns a user, regardless of any error field", () => {
    expect(classifyAuthCheck({ id: "u1" }, null)).toBe("authenticated");
  });

  it("is unverified on a retryable fetch error — the bug this exists to fix", () => {
    // This is the reproduction: a session that is genuinely still valid can
    // fail to verify because the network call to Supabase's auth server
    // itself failed (a DNS blip, a timeout, a moment of unavailability).
    // Before the fix, proxy.ts treated this identically to "no session" and
    // redirected a signed-in admin to the login page on an ordinary refresh
    // or after an idle tab's access token needed a refresh round trip.
    const error = new AuthRetryableFetchError("fetch failed", 0);
    expect(classifyAuthCheck(null, error)).toBe("unverified");
  });

  it("is unauthenticated when there is no user and no error (no session cookie at all)", () => {
    expect(classifyAuthCheck(null, null)).toBe("unauthenticated");
  });

  it("is unauthenticated on a definitive auth error, e.g. an expired/invalid refresh token", () => {
    const error = new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found");
    expect(classifyAuthCheck(null, error)).toBe("unauthenticated");
  });

  it("is unauthenticated when the session is simply missing", () => {
    const error = new AuthSessionMissingError();
    expect(classifyAuthCheck(null, error)).toBe("unauthenticated");
  });
});

describe("classifyAdminProfileLookup", () => {
  it("is admin when a profile row comes back", () => {
    expect(classifyAdminProfileLookup({ user_id: "u1" }, null)).toBe("admin");
  });

  it("is not-admin when the query succeeds with zero rows", () => {
    expect(classifyAdminProfileLookup(null, null)).toBe("not-admin");
  });

  it("is check-failed (not not-admin) when the query itself errored — the bug this exists to fix", () => {
    // Before the fix, checkAdmin() could not tell "this account genuinely
    // has no admin_profiles row" apart from "the query failed to run", and
    // requireAdmin() destroys the session (auth.signOut()) specifically on
    // "not-admin" — so a transient query failure forcibly signed a real
    // admin out instead of just asking them to try again.
    const error = { message: "server error", code: "500", details: "", hint: "" };
    expect(classifyAdminProfileLookup(null, error)).toBe("check-failed");
  });
});

describe("classifyJudgeLookup", () => {
  it("is judge when an active judge row comes back", () => {
    expect(classifyJudgeLookup({ id: "j1" }, null)).toBe("judge");
  });

  it("is not-judge when the query succeeds with zero rows — an inactive judge lands here too", () => {
    expect(classifyJudgeLookup(null, null)).toBe("not-judge");
  });

  it("is check-failed (not not-judge) when the query itself errored", () => {
    // requireJudge() signs the caller out on "not-judge", so a transient
    // query failure taking that branch would log a real judge out mid-event.
    const error = { message: "server error", code: "500", details: "", hint: "" };
    expect(classifyJudgeLookup(null, error)).toBe("check-failed");
  });
});
