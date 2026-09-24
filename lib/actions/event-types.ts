"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { countLabel, type DeleteResult, type UsageResult } from "@/lib/admin/usage";
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
 * deleted. */
export async function setEventTypeActiveAction(id: number, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase.from("event_types").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Events and templates reference a type by its current name (plain text,
 * no FK) — an event created under a since-renamed name doesn't count. */
async function eventTypeUsage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: number,
): Promise<UsageResult> {
  const { data: type, error: typeError } = await supabase
    .from("event_types")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (typeError) return { ok: false, error: typeError.message };
  if (!type) return { ok: false, error: "Event type not found" };

  const [events, templates] = await Promise.all([
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", type.name),
    supabase
      .from("event_templates")
      .select("id", { count: "exact", head: true })
      .eq("event_type", type.name),
  ]);
  const failed = [events, templates].find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  const usage: string[] = [];
  if ((events.count ?? 0) > 0) usage.push(`used by ${countLabel(events.count ?? 0, "event")}`);
  if ((templates.count ?? 0) > 0) {
    usage.push(`used by ${countLabel(templates.count ?? 0, "template")}`);
  }
  return { ok: true, usage };
}

/** What still uses an event type — empty means it can be deleted. */
export async function eventTypeUsageAction(id: number): Promise<UsageResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  return eventTypeUsage(supabase, id);
}

/** Deletes an event type only if no event or template uses it (re-checked
 * here, and enforced by the event_types_delete_guard trigger regardless). */
export async function deleteEventTypeAction(id: number): Promise<DeleteResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const usage = await eventTypeUsage(supabase, id);
  if (!usage.ok) return { ok: false, error: usage.error };
  if (usage.usage.length > 0) {
    return { ok: false, error: "This event type is in use", usage: usage.usage };
  }

  const { error } = await supabase.from("event_types").delete().eq("id", id);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "This event type was just put to use, so it can't be deleted — deactivate it instead."
          : error.message,
    };
  }
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
