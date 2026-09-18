import { createClient } from "@/lib/supabase/server";

export type AdminActor = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
};

/**
 * Shared admin gate for server actions (the RLS policies already restrict
 * what an admin can read/write, but a privileged action — creating an auth
 * user, sending event-wide email — needs its own explicit check before
 * doing anything, same as the doc on Server Actions security warns).
 */
export async function requireAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ actor: AdminActor } | { error: string }> {
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { error: "Not authenticated" };
  const userId = claims.claims.sub as string;
  const email = (claims.claims.email as string | undefined) ?? "";

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.is_admin) return { error: "Admins only" };

  return {
    actor: {
      userId,
      email,
      firstName: (profile.first_name as string | null) ?? "",
      lastName: (profile.last_name as string | null) ?? "",
    },
  };
}

/** "First Last <email>" for an email/audit-log line, falling back to just
 * the email when the actor's profile has no name on file. */
export function actorLabel(actor: AdminActor): string {
  const name = [actor.firstName, actor.lastName].filter(Boolean).join(" ");
  return name ? `${name} <${actor.email}>` : actor.email;
}
