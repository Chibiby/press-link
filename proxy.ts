import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { classifyAuthCheck } from "@/lib/auth/session-check";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // A retryable fetch error (a transient failure reaching Supabase's auth
  // server, not evidence the visitor is logged out) gets one immediate retry
  // before we give up on verifying the session — see lib/auth/session-check.ts.
  let { data, error } = await supabase.auth.getUser();
  if (error && isAuthRetryableFetchError(error)) {
    ({ data, error } = await supabase.auth.getUser());
  }
  const { user } = data;

  const path = request.nextUrl.pathname;
  const isAdminRoute = path.startsWith("/admin") && path !== "/admin/login";
  const isEntryRoute = path.startsWith("/entry");

  const authCheck = classifyAuthCheck(user, error);

  if (authCheck === "unauthenticated" && (isAdminRoute || isEntryRoute)) {
    const loginPath = isAdminRoute ? "/admin/login" : "/login";
    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/entry/:path*", "/admin/:path*"],
};
