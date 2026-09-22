"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import type { ShiftAnchor } from "@/lib/event-templates";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type TemplateRoleInput = {
  roleTypeId: string;
  description: string;
  whatToBring: string;
  /** Each boundary anchors independently to the event's start or end — see
   * lib/event-templates.ts. Offsets are signed minutes from their own
   * anchor (raw form text; negative = before, positive = after). */
  shiftStartAnchor: ShiftAnchor;
  shiftStartOffset: string;
  shiftEndAnchor: ShiftAnchor;
  shiftEndOffset: string;
  numberNeeded: string;
};

export type TemplateInput = {
  name: string;
  eventType: string;
  /** "" = available to every chapter. */
  chapter: string;
  description: string;
  /** "" = unlimited. */
  defaultCapacity: string;
  defaultRegistrationSections: string[];
  defaultVirtualLink: string;
  defaultVirtualAccessNotes: string;
  roles: TemplateRoleInput[];
};

const VALID_SECTION_IDS = new Set(
  REGISTRATION_SECTIONS.filter((s) => !s.alwaysRequired && !s.profileOnly).map((s) => s.id),
);

function validate(input: TemplateInput): string | null {
  if (!input.name.trim()) return "Name is required";
  if (!input.eventType.trim()) return "Event type is required";
  if (input.chapter && !CHAPTERS.some((c) => c.name === input.chapter) && input.chapter !== VIRTUAL_CHAPTER) {
    return "Choose a valid chapter, or leave it as all chapters";
  }
  if (input.defaultCapacity.trim()) {
    const n = Number(input.defaultCapacity.trim());
    if (!Number.isFinite(n) || n < 1) return "Default capacity must be at least 1, or left blank";
  }
  if (input.defaultRegistrationSections.some((id) => !VALID_SECTION_IDS.has(id))) {
    return "Unknown registration section";
  }
  for (const role of input.roles) {
    if (!role.roleTypeId.trim()) return "Every template role needs a role type";
    const needed = Number(role.numberNeeded.trim());
    if (!Number.isFinite(needed) || needed < 1) return "Number needed must be at least 1";
    const start = Number(role.shiftStartOffset.trim());
    const end = Number(role.shiftEndOffset.trim());
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return "Shift offsets must be numbers of minutes";
    }
    // No "end after start" check here — the two boundaries can anchor to
    // different points (e.g. start before event_start, end after event_end),
    // so whether the resulting times actually land in order depends on the
    // real event's length, which a template doesn't have. The create wizard
    // checks the concrete, applied times instead.
  }
  return null;
}

async function replaceRoles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateId: number,
  roles: TemplateRoleInput[],
): Promise<string | null> {
  const { error: deleteError } = await supabase
    .from("event_template_roles")
    .delete()
    .eq("template_id", templateId);
  if (deleteError) return deleteError.message;

  if (roles.length === 0) return null;

  const { error: insertError } = await supabase.from("event_template_roles").insert(
    roles.map((role, i) => ({
      template_id: templateId,
      role_type_id: Number(role.roleTypeId),
      description: role.description.trim() || null,
      what_to_bring: role.whatToBring.trim() || null,
      shift_start_anchor: role.shiftStartAnchor,
      shift_start_offset: Math.round(Number(role.shiftStartOffset.trim())),
      shift_end_anchor: role.shiftEndAnchor,
      shift_end_offset: Math.round(Number(role.shiftEndOffset.trim())),
      number_needed: Number(role.numberNeeded.trim()),
      sort_order: i,
    })),
  );
  return insertError?.message ?? null;
}

export async function createTemplateAction(input: TemplateInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const error0 = validate(input);
  if (error0) return { ok: false, error: error0 };

  const { data: created, error } = await supabase
    .from("event_templates")
    .insert({
      name: input.name.trim(),
      event_type: input.eventType,
      chapter: input.chapter || null,
      description: input.description.trim() || null,
      default_capacity: input.defaultCapacity.trim() ? Number(input.defaultCapacity.trim()) : null,
      default_registration_sections: input.defaultRegistrationSections,
      default_virtual_link: input.defaultVirtualLink.trim() || null,
      default_virtual_access_notes: input.defaultVirtualAccessNotes.trim() || null,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Failed to create template" };

  // Role rows need the service-role client: authenticated admins only have
  // select/insert/update/delete on event_template_roles via RLS's is_admin()
  // check, which this already satisfies — createClient (not createAdminClient)
  // is used consistently for every write in this file for that reason.
  const roleError = await replaceRoles(supabase, created.id, input.roles);
  if (roleError) {
    return { ok: false, error: `Template saved, but its roles failed to save: ${roleError}` };
  }
  return { ok: true };
}

export async function updateTemplateAction(id: number, input: TemplateInput): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const error0 = validate(input);
  if (error0) return { ok: false, error: error0 };

  const { error } = await supabase
    .from("event_templates")
    .update({
      name: input.name.trim(),
      event_type: input.eventType,
      chapter: input.chapter || null,
      description: input.description.trim() || null,
      default_capacity: input.defaultCapacity.trim() ? Number(input.defaultCapacity.trim()) : null,
      default_registration_sections: input.defaultRegistrationSections,
      default_virtual_link: input.defaultVirtualLink.trim() || null,
      default_virtual_access_notes: input.defaultVirtualAccessNotes.trim() || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const roleError = await replaceRoles(supabase, id, input.roles);
  if (roleError) {
    return { ok: false, error: `Template saved, but its roles failed to save: ${roleError}` };
  }
  return { ok: true };
}

/** Deactivating hides a template from the create wizard's picker but keeps
 * it for reference — editing or deactivating it never changes an event
 * already created from it, since nothing links back. */
export async function setTemplateActiveAction(id: number, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const { error } = await supabase.from("event_templates").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type SaveAsTemplateResult =
  | { ok: true; templateId: number; skippedRoles: number }
  | { ok: false; error: string };

/**
 * Turns an existing event into a reusable template: copies its description,
 * capacity, registration sections, virtual details, and volunteer roles
 * (only ones with a catalog role_type_id — a free-text "Custom / other" role
 * has nothing to carry into a template's role_type_id, which is NOT NULL, so
 * those are silently skipped and the caller is told how many). Shift times
 * are converted back to anchor + minute offset: start anchors to the event's
 * own start, end anchors to the event's own end when it has one, otherwise
 * falls back to anchoring the end to the start too (there's nothing else to
 * anchor it to).
 */
export async function saveEventAsTemplateAction(
  eventId: number,
  input: { name: string; chapter: string },
): Promise<SaveAsTemplateResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Template name is required" };
  if (
    input.chapter &&
    !CHAPTERS.some((c) => c.name === input.chapter) &&
    input.chapter !== VIRTUAL_CHAPTER
  ) {
    return { ok: false, error: "Choose a valid chapter, or leave it as all chapters" };
  }

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, event_type, starts_at, ends_at, description, capacity, registration_sections, virtual_link, virtual_access_notes",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, error: "Event not found" };

  const { data: opportunities } = await supabase
    .from("volunteer_opportunities")
    .select("role_type_id, description, what_to_bring, shift_start, shift_end, slots")
    .eq("event_id", eventId)
    .is("cancelled_at", null);

  const startsAt = new Date(event.starts_at as string).getTime();
  const endsAt = event.ends_at ? new Date(event.ends_at as string).getTime() : null;
  const withRoleType = (opportunities ?? []).filter((o) => o.role_type_id != null);
  const skipped = (opportunities ?? []).length - withRoleType.length;

  const { data: created, error } = await supabase
    .from("event_templates")
    .insert({
      name,
      event_type: event.event_type,
      chapter: input.chapter || null,
      description: event.description,
      default_capacity: event.capacity,
      default_registration_sections: event.registration_sections ?? [],
      default_virtual_link: event.virtual_link,
      default_virtual_access_notes: event.virtual_access_notes,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Failed to create template" };

  if (withRoleType.length > 0) {
    const { error: roleError } = await supabase.from("event_template_roles").insert(
      withRoleType.map((o, i) => ({
        template_id: created.id,
        role_type_id: o.role_type_id,
        description: o.description,
        what_to_bring: o.what_to_bring,
        shift_start_anchor: "event_start" as const,
        shift_start_offset: Math.round(
          (new Date(o.shift_start as string).getTime() - startsAt) / 60_000,
        ),
        shift_end_anchor: (endsAt != null ? "event_end" : "event_start") as ShiftAnchor,
        shift_end_offset: Math.round(
          (new Date(o.shift_end as string).getTime() - (endsAt ?? startsAt)) / 60_000,
        ),
        number_needed: o.slots,
        sort_order: i,
      })),
    );
    if (roleError) {
      return {
        ok: false,
        error: `Template saved, but its roles failed to save: ${roleError.message}`,
      };
    }
  }

  return { ok: true, templateId: created.id, skippedRoles: skipped };
}
