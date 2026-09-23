import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { safeNext } from "../safe-next";
import { resolvePublicEventRoute } from "../public-event-route";

/** Carries the refreshed session cookies over onto a response other than
 * supabaseResponse — see the IMPORTANT note at the end of updateSession. */
function withSessionCookies(response: NextResponse, supabaseResponse: NextResponse) {
  supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  // A signed-in visitor hitting the marketing landing page belongs on the
  // events list instead — redirect here (before any rendering) rather than
  // in the page itself, so there's no logged-in flash of the hero.
  if (user && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/protected/events";
    return NextResponse.redirect(url);
  }

  // Public event pages: settle "is there such an event" here, before the
  // page streams — the only way to answer with a real 404, or a real 308
  // for an old numeric-id URL / retired slug (see lib/public-event-route.ts).
  // Only the page itself (/events/<x>), not its preview-image routes.
  const publicEvent = request.nextUrl.pathname.match(/^\/events\/([^/]+)\/?$/);
  if (publicEvent) {
    const route = await resolvePublicEventRoute(publicEvent[1]);
    if (route.kind !== "current") {
      const url = request.nextUrl.clone();
      if (route.kind === "redirect") {
        url.pathname = `/events/${route.slug}`;
        return withSessionCookies(NextResponse.redirect(url, 308), supabaseResponse);
      }
      // No route matches this path, so Next renders the not-found page with
      // a 404 status.
      url.pathname = "/events/not-found/404";
      return withSessionCookies(NextResponse.rewrite(url, { status: 404 }), supabaseResponse);
    }
  }

  if (
    request.nextUrl.pathname !== "/" &&
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    // Public, shareable event pages (and their preview images) — what they
    // can read is limited by the database, not this check (see
    // lib/public-events.ts).
    !request.nextUrl.pathname.startsWith("/events/") &&
    // Machine-called endpoints authenticate themselves (CRON_SECRET).
    !request.nextUrl.pathname.startsWith("/api/cron")
  ) {
    // no user, potentially respond by redirecting the user to the login page
    // — remembering where they were headed, so signing in (or up) brings
    // them back (see lib/safe-next.ts).
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = "";
    const destination = safeNext(`${request.nextUrl.pathname}${request.nextUrl.search}`);
    if (destination) url.searchParams.set("next", destination);
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
