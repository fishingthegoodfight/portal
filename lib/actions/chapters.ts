"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { US_STATES } from "@/lib/us-states";
import { CHAPTER_TIMEZONES } from "@/lib/chapter-timezones";

export type ActionResult = { ok: true } | { ok: false; error: string };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Setup → Regions & chapters. Admins only (requireAdmin here; the regions
 * and chapters RLS policies say the same). Neither is ever deleted —
 * deactivate instead — since chapter names are stored on events, profiles
 * and applications. */

function duplicateOr(error: { code?: string; message: string }, duplicate: string): string {
  return error.code === "23505" ? duplicate : error.message;
}

async function nextSortOrder(
  supabase: ServerClient,
  table: "regions" | "chapters",
  regionId?: number,
): Promise<number> {
  let query = supabase.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
  if (regionId != null) query = query.eq("region_id", regionId);
  const { data } = await query.maybeSingle();
  return ((data?.sort_order as number | undefined) ?? 0) + 10;
}

/** `orderedIds` is every row's id (of one region, for chapters) in its new
 * top-to-bottom order. */
async function saveOrder(
  supabase: ServerClient,
  table: "regions" | "chapters",
  orderedIds: number[],
): Promise<ActionResult> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from(table)
      .update({ sort_order: (i + 1) * 10 })
      .eq("id", orderedIds[i]);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ---- Regions -------------------------------------------------------------------

const DUPLICATE_REGION = "There's already a region with that name";

export async function createRegionAction(name: string): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required" };
  const { error } = await supabase
    .from("regions")
    .insert({ name: trimmed, sort_order: await nextSortOrder(supabase, "regions") });
  if (error) return { ok: false, error: duplicateOr(error, DUPLICATE_REGION) };
  return { ok: true };
}

/** A region is referenced by id only, so renaming changes nothing else. */
export async function renameRegionAction(id: number, name: string): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required" };
  const { error } = await supabase
    .from("regions")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: duplicateOr(error, DUPLICATE_REGION) };
  return { ok: true };
}

/** Deactivating hides a region from the picker for new or moved chapters;
 * its chapters, and everything grouped by it, carry on as they are. */
export async function setRegionActiveAction(id: number, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase
    .from("regions")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function reorderRegionsAction(orderedIds: number[]): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  return saveOrder(supabase, "regions", orderedIds);
}

// ---- Chapters ------------------------------------------------------------------

export type ChapterInput = {
  name: string;
  /** "" = none (the name is shown everywhere). */
  displayName: string;
  regionId: number;
  state: string;
  timezone: string;
};

const DUPLICATE_CHAPTER = "There's already a chapter with that name (or one that makes the same filter link)";
const RESERVED_NAMES = ["virtual", "no local chapter", "not local to a chapter", "all"];

function validateChapter(input: ChapterInput): string | null {
  const name = input.name.trim();
  if (!name) return "Name is required";
  if (name.includes(",")) return "A chapter name can't contain a comma";
  if (RESERVED_NAMES.includes(name.toLowerCase())) return `"${name}" is reserved — choose another name`;
  if (!Number.isInteger(input.regionId) || input.regionId <= 0) return "Choose a region";
  if (!US_STATES.includes(input.state)) return "Choose a state";
  if (!input.timezone) return "Choose a time zone";
  return null;
}

function chapterColumns(input: ChapterInput) {
  return {
    display_name: input.displayName.trim() || null,
    region_id: input.regionId,
    state: input.state,
    timezone: input.timezone,
  };
}

/** A new chapter goes at the end of its region. Its events use the state's
 * waiver, so that state needs a published waiver (Setup → Waivers) before
 * its events can take registrations. */
export async function createChapterAction(input: ChapterInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const problem = validateChapter(input);
  if (problem) return { ok: false, error: problem };
  if (!CHAPTER_TIMEZONES.some((tz) => tz.value === input.timezone)) return { ok: false, error: "Choose a time zone" };

  const { error } = await supabase.from("chapters").insert({
    name: input.name.trim(),
    ...chapterColumns(input),
    sort_order: await nextSortOrder(supabase, "chapters", input.regionId),
  });
  if (error) return { ok: false, error: duplicateOr(error, DUPLICATE_CHAPTER) };
  return { ok: true };
}

/**
 * Saves a chapter's details. A new name goes through admin_rename_chapter,
 * which renames every stored copy (events, profiles, chapter leads,
 * templates, venues, applications, reference answers) in one transaction.
 * Changing the state or time zone applies to events created from now on —
 * each event keeps its own waiver state and time zone.
 */
export async function updateChapterAction(id: number, input: ChapterInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const problem = validateChapter(input);
  if (problem) return { ok: false, error: problem };

  const { data: current, error: loadError } = await supabase
    .from("chapters")
    .select("name, region_id, timezone")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return { ok: false, error: loadError.message };
  if (!current) return { ok: false, error: "Chapter not found" };
  // A zone that's no longer offered stays allowed on the chapter that has it.
  if (input.timezone !== current.timezone && !CHAPTER_TIMEZONES.some((tz) => tz.value === input.timezone)) {
    return { ok: false, error: "Choose a time zone" };
  }

  const name = input.name.trim();
  if (name !== current.name) {
    const { error: renameError } = await supabase.rpc("admin_rename_chapter", { p_chapter_id: id, p_name: name });
    if (renameError) return { ok: false, error: duplicateOr(renameError, DUPLICATE_CHAPTER) };
  }

  const moved = input.regionId !== current.region_id;
  const { error } = await supabase
    .from("chapters")
    .update({
      ...chapterColumns(input),
      // Moving to another region puts it at the end of that region.
      ...(moved ? { sort_order: await nextSortOrder(supabase, "chapters", input.regionId) } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Deactivating hides a chapter from every picker and the events filter;
 * its events, people and leads keep it. */
export async function setChapterActiveAction(id: number, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase.from("chapters").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function reorderChaptersAction(orderedIds: number[]): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  return saveOrder(supabase, "chapters", orderedIds);
}
