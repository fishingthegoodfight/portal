"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { INTEREST_AREA_KINDS, type InterestAreaKind } from "@/lib/volunteer-applications";

export type InterestAreaResult = { ok: true } | { ok: false; error: string };

export type InterestAreaInput = { kind: InterestAreaKind; label: string; description: string; sortOrder: number };

/** "Teaching fly fishing on the water" -> "teaching_fly_fishing_on_the_water". */
function slugify(label: string): string {
  return label.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "area";
}

function validate(input: InterestAreaInput): string | null {
  if (!INTEREST_AREA_KINDS.some((k) => k.value === input.kind)) return "Choose which list it goes in";
  if (!input.label.trim()) return "The wording is required";
  if (!Number.isInteger(input.sortOrder)) return "Order should be a whole number";
  return null;
}

/**
 * Setup → Interest areas (volunteer_interest_areas): the two lists on the
 * volunteer application — skills & interest areas, and programs — mirroring
 * the volunteer registration form's. Separate from volunteer role types on purpose — rewording
 * here never touches a role. Admins only; never deleted, only turned off,
 * so applications that picked one keep its wording.
 */
export async function createInterestAreaAction(input: InterestAreaInput): Promise<InterestAreaResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  const base = slugify(input.label);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase.from("volunteer_interest_areas").insert({
      key: attempt === 0 ? base : `${base}_${attempt + 1}`,
      kind: input.kind,
      label: input.label.trim(),
      description: input.description.trim() || null,
      sort_order: input.sortOrder,
    });
    if (!error) return { ok: true };
    if (error.code !== "23505") return { ok: false, error: error.message };
  }
  return { ok: false, error: "Couldn't save this interest area — try different wording." };
}

export async function updateInterestAreaAction(id: number, input: InterestAreaInput): Promise<InterestAreaResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  const problem = validate(input);
  if (problem) return { ok: false, error: problem };
  const { error } = await supabase
    .from("volunteer_interest_areas")
    .update({ kind: input.kind, label: input.label.trim(), description: input.description.trim() || null, sort_order: input.sortOrder })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setInterestAreaActiveAction(id: number, active: boolean): Promise<InterestAreaResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  const { error } = await supabase.from("volunteer_interest_areas").update({ active }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
