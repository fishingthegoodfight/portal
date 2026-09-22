"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";

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
