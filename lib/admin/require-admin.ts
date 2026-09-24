import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/roles";

export type { Role } from "@/lib/roles";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type AdminActor = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
};

type Gate = { actor: AdminActor } | { error: string };

async function loadActor(supabase: SupabaseServerClient): Promise<AdminActor | null> {
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return null;
  const userId = claims.claims.sub as string;
  const email = (claims.claims.email as string | undefined) ?? "";

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, first_name, last_name")
    .eq("id", userId)
    .maybeSingle();

  return {
    userId,
    email,
    firstName: (profile?.first_name as string | null) ?? "",
    lastName: (profile?.last_name as string | null) ?? "",
    role: ((profile?.role as Role | null) ?? "participant") as Role,
  };
}

/**
 * Admin-only gate for server actions — setup screens, the volunteer
 * registry, waivers, roles. (RLS enforces the same thing; a privileged
 * action — creating an auth user, sending event-wide email — needs its own
 * explicit check before doing anything, as the Server Actions security docs
 * warn.)
 */
export async function requireAdmin(supabase: SupabaseServerClient): Promise<Gate> {
  const actor = await loadActor(supabase);
  if (!actor) return { error: "Not authenticated" };
  if (actor.role !== "admin") return { error: "Admins only" };
  return { actor };
}

/**
 * Gate for anything done to one event (edit, cancel, roster, walk-ups,
 * volunteer shifts). Asks the database's can_manage_event() — the single
 * definition of who manages an event (admin, the chapter's lead, or the
 * event's own lead) — rather than re-deriving it here.
 */
export async function requireEventManager(
  supabase: SupabaseServerClient,
  eventId: number,
): Promise<Gate> {
  const actor = await loadActor(supabase);
  if (!actor) return { error: "Not authenticated" };
  const { data: allowed, error } = await supabase.rpc("can_manage_event", { p_event_id: eventId });
  if (error) return { error: error.message };
  if (!allowed) return { error: "You don't manage this event" };
  return { actor };
}

/** Gate for creating an event in a chapter — the database's
 * can_manage_chapter() (admin, or a chapter lead who leads it). */
export async function requireChapterManager(
  supabase: SupabaseServerClient,
  chapter: string,
): Promise<Gate> {
  const actor = await loadActor(supabase);
  if (!actor) return { error: "Not authenticated" };
  const { data: allowed, error } = await supabase.rpc("can_manage_chapter", { p_chapter: chapter });
  if (error) return { error: error.message };
  if (!allowed) return { error: "You can only create events in a chapter you lead" };
  return { actor };
}

/** Gate for the event-management area as a whole (admins, chapter leads,
 * and anyone who leads an event) — has_event_admin_access(). */
export async function requireEventAdminAccess(supabase: SupabaseServerClient): Promise<Gate> {
  const actor = await loadActor(supabase);
  if (!actor) return { error: "Not authenticated" };
  const { data: allowed, error } = await supabase.rpc("has_event_admin_access");
  if (error) return { error: error.message };
  if (!allowed) return { error: "Not allowed" };
  return { actor };
}

/** "First Last <email>" for an email/audit-log line, falling back to just
 * the email when the actor's profile has no name on file; non-admins get
 * their role appended, e.g. "… (chapter lead)". */
export function actorLabel(actor: AdminActor): string {
  const name = [actor.firstName, actor.lastName].filter(Boolean).join(" ");
  const who = name ? `${name} <${actor.email}>` : actor.email;
  return actor.role === "admin" ? who : `${who} (${ROLE_LABELS[actor.role].toLowerCase()})`;
}

/**
 * What the signed-in person can reach in the event-management area — for
 * pages and navigation. Every answer comes from the database functions, so
 * nothing here re-implements the manage rule.
 */
export type EventAdminAccess = {
  userId: string;
  role: Role;
  isAdmin: boolean;
  ledChapters: string[];
  /** has_event_admin_access(): may enter /protected/admin at all. */
  hasAccess: boolean;
};

export async function loadEventAdminAccess(
  supabase: SupabaseServerClient,
): Promise<EventAdminAccess | null> {
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return null;
  const userId = claims.claims.sub as string;

  const [{ data: profile }, { data: hasAccess }] = await Promise.all([
    supabase.from("profiles").select("role, led_chapters").eq("id", userId).maybeSingle(),
    supabase.rpc("has_event_admin_access"),
  ]);
  const role = ((profile?.role as Role | null) ?? "participant") as Role;
  return {
    userId,
    role,
    isAdmin: role === "admin",
    ledChapters: (profile?.led_chapters as string[] | null) ?? [],
    hasAccess: Boolean(hasAccess),
  };
}

/** The ids of every event the caller manages (managed_event_ids()). */
export async function loadManagedEventIds(supabase: SupabaseServerClient): Promise<Set<number>> {
  const { data } = await supabase.rpc("managed_event_ids");
  // setof bigint — accept both bare values and single-key rows.
  return new Set(
    ((data ?? []) as unknown[]).map((row) =>
      Number(row != null && typeof row === "object" ? Object.values(row)[0] : row),
    ),
  );
}

/** Which of `chapters` the caller may create events in
 * (manageable_chapters(), i.e. can_manage_chapter for each). */
export async function loadManageableChapters(
  supabase: SupabaseServerClient,
  chapters: string[],
): Promise<string[]> {
  const { data } = await supabase.rpc("manageable_chapters", { p_chapters: chapters });
  return (data as string[] | null) ?? [];
}
