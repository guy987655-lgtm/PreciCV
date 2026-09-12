import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isDemoPath } from "@/lib/demo";
import { resolveVisitor, VISITOR_HEADER } from "@/lib/visitor";

const PROTECTED_PREFIXES = [
  "/onboarding",
  "/jobs",
  "/my-account",
  "/continue",
  "/run",
];

export async function proxy(request: NextRequest) {
  // The demo pages and the exhibit manifest are public, fixture-only surfaces
  // for the portfolio site: no visitor id, no session lookup, nothing counted.
  const { pathname } = request.nextUrl;
  if (isDemoPath(pathname) || pathname === "/api/exhibit") {
    return NextResponse.next();
  }

  // The visitor id is resolved FIRST — before the Supabase env check below —
  // so a deploy missing its Supabase config still counts its visitors. No
  // database work happens here: this runs on every navigation and every RSC
  // prefetch, and a round trip would tax all of that traffic. See lib/visitor.ts.
  const visitor = resolveVisitor(request);

  // Forwarded on a Headers object we own, with any inbound value dropped first
  // so a browser can never inject its own visitor id. Routes read the header
  // rather than the cookie because on a new visitor's first request the cookie
  // exists only in the response.
  //
  // A FUNCTION, not a constant, and this is load-bearing: Supabase's setAll
  // below calls request.cookies.set(), which mutates request.headers in place.
  // A snapshot taken here would still hold the pre-refresh auth token, so on
  // every token refresh the downstream route would be handed an expired
  // cookie. Rebuilding at each call site reads the headers as they are now.
  const nextArgs = () => {
    const headers = new Headers(request.headers);
    headers.delete(VISITOR_HEADER);
    headers.set(VISITOR_HEADER, visitor.id);
    return { request: { headers } };
  };

  // Applied at every return point rather than at construction. Supabase's
  // setAll callback below REPLACES `response` wholesale, so a cookie set on
  // the original object would be silently dropped; stamping on the way out
  // means whichever response actually leaves this function carries it.
  const stamp = (res: NextResponse) => {
    if (visitor.cookie) {
      res.cookies.set(
        visitor.cookie.name,
        visitor.cookie.value,
        visitor.cookie.options
      );
    }
    return res;
  };

  // Not configured yet (fresh clone without .env.local): let pages through
  // so the landing page still renders.
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    return stamp(NextResponse.next(nextArgs()));
  }

  let response = NextResponse.next(nextArgs());

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next(nextArgs());
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path.startsWith(p));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return stamp(NextResponse.redirect(url));
  }

  if (user && path === "/login") {
    // An already-signed-in user redoing the funnel arrives with
    // ?next=/continue — honour it, or they'd be dumped on the homepage and
    // their new job (and its free sample) would never be created. Only
    // same-origin relative paths, so this can't become an open redirect.
    const next = request.nextUrl.searchParams.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//");
    if (safeNext) {
      return stamp(NextResponse.redirect(new URL(next, request.url)));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return stamp(NextResponse.redirect(url));
  }

  return stamp(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/payments/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
