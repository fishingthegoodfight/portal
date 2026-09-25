import { getSiteUrl } from "@/lib/site-url";

/**
 * Links into app/auth/confirm/route.ts, for emails the app sends itself —
 * the volunteer invite (lib/actions/volunteer-invite.ts) and the portal
 * invite (lib/actions/person-invite.ts). One definition, so a change to the
 * route or the site's domain can't reach one invite and miss the other.
 */

/** The confirm route's absolute URL — also what generateLink is given as
 * `redirectTo`. */
export function authConfirmUrl(): string {
  return `${getSiteUrl()}/auth/confirm`;
}

/**
 * Builds a link through our own /auth/confirm route (token_hash + type,
 * verified server-side with verifyOtp — see app/auth/confirm/route.ts)
 * instead of using Supabase's own action_link. The action_link redirects
 * with the session in a URL *fragment*, which nothing in this app parses
 * (there's no client-side "detect session in URL" step on the pages these
 * links land on), so it silently failed to establish a session; token_hash
 * avoids that entirely by exchanging it for cookies on our own server route.
 */
export function buildConfirmUrl(tokenHash: string, type: "invite" | "recovery", next: string): string {
  const url = new URL(authConfirmUrl());
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("next", next);
  return url.toString();
}
