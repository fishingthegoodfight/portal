"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireChapterManager } from "@/lib/admin/require-admin";
import type { DeleteResult, UsageResult } from "@/lib/admin/usage";
import { CHAPTERS, isVirtualChapter } from "@/lib/chapters";
import { locationErrors, type LocationFieldsValue } from "@/lib/event-location";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type VenueInput = LocationFieldsValue & {
  /** "" = offered to every chapter. */
  chapter: string;
};

function validate(input: VenueInput): string | null {
  if (input.chapter && !CHAPTERS.some((c) => c.name === input.chapter)) {
    return "Choose a chapter, or leave it as all chapters";
  }
  // Same rule as an event's own address — a saved venue fills those fields.
  const problems = locationErrors(input);
  return problems.length > 0 ? problems.join("; ") : null;
}

function venueColumns(input: VenueInput) {
  return {
    name: input.venueName.trim(),
    street_address: input.streetAddress.trim(),
    city: input.city.trim(),
    state: input.state.trim().toUpperCase(),
    postal_code: input.postalCode.trim() || null,
    chapter: input.chapter || null,
  };
}

const DUPLICATE_NAME = "A venue with that name already exists for this chapter";

export async function createVenueAction(input: VenueInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  const { error } = await supabase.from("venues").insert(venueColumns(input));
  if (error) return { ok: false, error: error.code === "23505" ? DUPLICATE_NAME : error.message };
  return { ok: true };
}

/** Editing a venue never changes an event — events keep their own copy of
 * the address (see lib/venues.ts). */
export async function updateVenueAction(id: number, input: VenueInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  const { error } = await supabase.from("venues").update(venueColumns(input)).eq("id", id);
  if (error) return { ok: false, error: error.code === "23505" ? DUPLICATE_NAME : error.message };
  return { ok: true };
}

/** Retiring hides a venue from the pickers; nothing else changes. */
export async function setVenueActiveAction(id: number, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase.from("venues").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Nothing references a venue row — events and templates hold their own
 * copy of the address — so a venue can always be deleted. Kept for the
 * shared Setup delete flow (useDeleteFlow), which asks first. */
export async function venueUsageAction(): Promise<UsageResult> {
  return { ok: true, usage: [] };
}

export async function deleteVenueAction(id: number): Promise<DeleteResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase.from("venues").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * "Save this venue for next time" on the event create/edit forms: adds the
 * address just typed to the saved venues for the event's chapter. Admins and
 * leads of that chapter (can_manage_chapter — the venues insert policy
 * enforces the same). A venue of that name already saved for the chapter
 * counts as done, not an error: it's already on the list.
 */
export async function saveVenueFromEventAction(input: VenueInput): Promise<ActionResult> {
  const supabase = await createClient();
  if (!input.chapter || isVirtualChapter(input.chapter)) {
    return { ok: false, error: "Choose the event's chapter before saving its venue" };
  }
  const gate = await requireChapterManager(supabase, input.chapter);
  if ("error" in gate) return { ok: false, error: "You can only save venues for a chapter you lead" };

  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  const { error } = await supabase.from("venues").insert(venueColumns(input));
  if (error && error.code !== "23505") return { ok: false, error: error.message };
  return { ok: true };
}
