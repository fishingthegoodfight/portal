import { createAnonClient } from "@/lib/supabase/anon";

export type PublicEventRoute =
  | { kind: "current" }
  /** An old numeric-id URL, or a slug the event had before an admin changed it. */
  | { kind: "redirect"; slug: string }
  | { kind: "not_found" };

/**
 * What a /events/<param> URL points at, as anon sees it (unpublished events
 * don't exist for anon). Run by the proxy BEFORE the page renders: with
 * Cache Components the page streams its shell as a 200 before it can look
 * anything up, so a real 404 / 308 has to be decided here — see
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md.
 * The page repeats the same checks (lib/public-events.ts) as a backstop.
 */
export async function resolvePublicEventRoute(param: string): Promise<PublicEventRoute> {
  let key: string;
  try {
    key = decodeURIComponent(param).trim().toLowerCase();
  } catch {
    return { kind: "not_found" };
  }
  const supabase = createAnonClient();

  if (/^\d+$/.test(key)) {
    const { data } = await supabase.from("events").select("slug").eq("id", Number(key)).maybeSingle();
    return data ? { kind: "redirect", slug: data.slug as string } : { kind: "not_found" };
  }

  const { data: event } = await supabase.from("events").select("slug").eq("slug", key).maybeSingle();
  if (event) return key === param ? { kind: "current" } : { kind: "redirect", slug: key };

  const { data: alias } = await supabase
    .from("event_slug_aliases")
    .select("event_id")
    .eq("slug", key)
    .maybeSingle();
  if (!alias) return { kind: "not_found" };
  const { data: current } = await supabase
    .from("events")
    .select("slug")
    .eq("id", alias.event_id as number)
    .maybeSingle();
  return current ? { kind: "redirect", slug: current.slug as string } : { kind: "not_found" };
}
