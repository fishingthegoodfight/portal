"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type EventTypeInput = {
  name: string;
  defaultRegistrationSections: string[];
};

/** kebab_case-ish key from the name, e.g. "Fish A-Long" -> "fish_a_long". */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/'/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "type"
  );
}

const VALID_SECTION_IDS = new Set(
  REGISTRATION_SECTIONS.filter((s) => !s.alwaysRequired && !s.profileOnly).map((s) => s.id),
);

function validate(input: EventTypeInput): string | null {
  if (!input.name.trim()) return "Name is required";
  if (input.defaultRegistrationSections.some((id) => !VALID_SECTION_IDS.has(id))) {
    return "Unknown registration section";
  }
  return null;
}

export async function createEventTypeAction(input: EventTypeInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const error0 = validate(input);
  if (error0) return { ok: false, error: error0 };

  const { data: maxRow } = await supabase
    .from("event_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = ((maxRow?.sort_order as number | undefined) ?? 0) + 10;

  const baseKey = slugify(input.name);
  let key = baseKey;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase.from("event_types").insert({
      key,
      name: input.name.trim(),
      default_registration_sections: input.defaultRegistrationSections,
      sort_order: nextSortOrder,
    });
    if (!error) return { ok: true };
    // 23505 = unique violation on key or name — retry with a suffixed key
    // (a duplicate name still fails, since name has its own unique
    // constraint and this doesn't touch it).
    if (error.code !== "23505") return { ok: false, error: error.message };
    key = `${baseKey}_${attempt + 2}`;
  }
  return { ok: false, error: "Couldn't save this event type — the name may already be in use." };
}

export async function updateEventTypeAction(id: number, input: EventTypeInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const error0 = validate(input);
  if (error0) return { ok: false, error: error0 };

  const { error } = await supabase
    .from("event_types")
    .update({
      name: input.name.trim(),
      default_registration_sections: input.defaultRegistrationSections,
    })
    .eq("id", id);
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "That name is already in use." : error.message,
    };
  }
  return { ok: true };
}

/** Deactivating hides a type from the create wizard's picker but never
 * changes an event that already has it — a plain flag flip, nothing is
 * deleted (there's no DELETE policy on this table at all). */
export async function setEventTypeActiveAction(id: number, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase.from("event_types").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** `orderedIds` is every event type's id in its new top-to-bottom order. */
export async function reorderEventTypesAction(orderedIds: number[]): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("event_types")
      .update({ sort_order: (i + 1) * 10 })
      .eq("id", orderedIds[i]);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
