"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { countLabel, type DeleteResult, type UsageResult } from "@/lib/admin/usage";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type RoleTypeInput = {
  name: string;
  description: string;
  forRetreats: boolean;
  forChapterEvents: boolean;
  requiresCert: boolean;
};

/** kebab_case-ish key from the name, e.g. "Men's Night Lead" -> "mens_night_lead". */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/'/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "role"
  );
}

function validate(input: RoleTypeInput): string | null {
  if (!input.name.trim()) return "Name is required";
  if (!input.forRetreats && !input.forChapterEvents) {
    return "A role type must apply to retreats, chapter events, or both";
  }
  return null;
}

export async function createRoleTypeAction(input: RoleTypeInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const error0 = validate(input);
  if (error0) return { ok: false, error: error0 };

  const { data: maxRow } = await supabase
    .from("volunteer_role_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = ((maxRow?.sort_order as number | undefined) ?? 0) + 10;

  const baseKey = slugify(input.name);
  let key = baseKey;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase.from("volunteer_role_types").insert({
      key,
      name: input.name.trim(),
      description: input.description.trim() || null,
      for_retreats: input.forRetreats,
      for_chapter_events: input.forChapterEvents,
      requires_cert: input.requiresCert,
      sort_order: nextSortOrder,
    });
    if (!error) return { ok: true };
    if (error.code !== "23505") return { ok: false, error: error.message };
    key = `${baseKey}_${attempt + 2}`;
  }
  return { ok: false, error: "Couldn't generate a unique key for this role type — try a different name." };
}

export async function updateRoleTypeAction(
  id: number,
  input: RoleTypeInput,
): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const error0 = validate(input);
  if (error0) return { ok: false, error: error0 };

  const { error } = await supabase
    .from("volunteer_role_types")
    .update({
      name: input.name.trim(),
      description: input.description.trim() || null,
      for_retreats: input.forRetreats,
      for_chapter_events: input.forChapterEvents,
      requires_cert: input.requiresCert,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Deactivating hides a role type from new event builds and new approvals
 * but leaves existing approvals and past event roles intact — it's a plain
 * flag flip, nothing is deleted. */
export async function setRoleTypeActiveAction(id: number, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase.from("volunteer_role_types").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function roleTypeUsage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: number,
): Promise<UsageResult> {
  const [approved, revoked, eventRoles, templateRoles] = await Promise.all([
    supabase
      .from("volunteer_role_approvals")
      .select("id", { count: "exact", head: true })
      .eq("role_type_id", id)
      .is("revoked_at", null),
    supabase
      .from("volunteer_role_approvals")
      .select("id", { count: "exact", head: true })
      .eq("role_type_id", id)
      .not("revoked_at", "is", null),
    supabase
      .from("volunteer_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("role_type_id", id),
    supabase.from("event_template_roles").select("template_id").eq("role_type_id", id),
  ]);
  const failed = [approved, revoked, eventRoles, templateRoles].find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  const usage: string[] = [];
  const approvedCount = approved.count ?? 0;
  if (approvedCount > 0) {
    usage.push(
      `${countLabel(approvedCount, "volunteer")} ${approvedCount === 1 ? "is" : "are"} approved for this role`,
    );
  }
  const revokedCount = revoked.count ?? 0;
  if (revokedCount > 0) {
    usage.push(
      `${countLabel(revokedCount, "revoked approval")} ${revokedCount === 1 ? "is" : "are"} kept on record for this role`,
    );
  }
  const eventRoleCount = eventRoles.count ?? 0;
  if (eventRoleCount > 0) {
    usage.push(`used by ${countLabel(eventRoleCount, "event volunteer role")}`);
  }
  const templateCount = new Set((templateRoles.data ?? []).map((r) => r.template_id)).size;
  if (templateCount > 0) usage.push(`used in ${countLabel(templateCount, "template")}`);
  return { ok: true, usage };
}

/** What still references a role type — empty means it can be deleted. */
export async function roleTypeUsageAction(id: number): Promise<UsageResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  return roleTypeUsage(supabase, id);
}

/** Deletes a role type only if nothing references it (re-checked here, and
 * enforced by the FKs regardless) — otherwise refuses with what's using it,
 * and the admin can deactivate it instead. */
export async function deleteRoleTypeAction(id: number): Promise<DeleteResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const usage = await roleTypeUsage(supabase, id);
  if (!usage.ok) return { ok: false, error: usage.error };
  if (usage.usage.length > 0) {
    return { ok: false, error: "This role type is in use", usage: usage.usage };
  }

  const { error } = await supabase.from("volunteer_role_types").delete().eq("id", id);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "This role type was just put to use, so it can't be deleted — deactivate it instead."
          : error.message,
    };
  }
  return { ok: true };
}

/** Persists a full reorder within one group (the admin screen only ever
 * reorders within retreats/chapter-events/both — see roleTypeGroup) —
 * `orderedIds` is that group's ids in their new top-to-bottom order. Spaces
 * sort_order by 10s starting from the lowest value already in use anywhere,
 * plus this group's position, so groups never interleave unpredictably. */
export async function reorderRoleTypesAction(orderedIds: number[]): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("volunteer_role_types")
      .update({ sort_order: (i + 1) * 10 })
      .eq("id", orderedIds[i]);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
