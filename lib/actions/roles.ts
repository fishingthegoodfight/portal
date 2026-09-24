"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import type { Role } from "@/lib/roles";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";

export type SetRoleResult = { ok: true } | { ok: false; error: string };

const ROLES: Role[] = ["participant", "chapter_lead", "admin"];
const CHAPTER_NAMES = new Set([...CHAPTERS.map((c) => c.name), VIRTUAL_CHAPTER]);

/**
 * Admin-only: set someone's role, and which chapters a chapter lead covers.
 * admin_set_user_role re-checks that the caller is an admin and refuses to
 * demote the last admin; profiles_role_guard stops anyone else changing a
 * role by any other route.
 */
export async function setUserRoleAction(
  userId: string,
  role: Role,
  ledChapters: string[],
): Promise<SetRoleResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  if (!ROLES.includes(role)) return { ok: false, error: "Choose a role" };
  const chapters = role === "chapter_lead" ? [...new Set(ledChapters)] : [];
  if (chapters.some((c) => !CHAPTER_NAMES.has(c))) return { ok: false, error: "Unknown chapter" };
  if (role === "chapter_lead" && chapters.length === 0) {
    return { ok: false, error: "Pick at least one chapter for a chapter lead" };
  }

  const { error } = await supabase.rpc("admin_set_user_role", {
    p_user_id: userId,
    p_role: role,
    p_led_chapters: chapters,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
