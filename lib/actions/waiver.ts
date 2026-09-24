"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireEventManager } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileValueFromColumn, REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import {
  isWaiverState,
  resolveEventWaiver,
  resolveVolunteerWaiverForEvent,
  waiverInfoForUser,
  type WaiverEvent,
  type WaiverInfo,
} from "@/lib/waivers";

const WAIVER_EVENT_COLUMNS = "id, chapter, waiver_state, starts_at, timezone, registration_sections";

type WaiverEventRow = WaiverEvent & { id: number; registration_sections: string[] | null };

async function loadWaiverEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: number,
): Promise<WaiverEventRow | null> {
  const { data } = await supabase
    .from("events")
    .select(WAIVER_EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  return (data as WaiverEventRow | null) ?? null;
}

export type SignWaiverResult = { ok: true } | { ok: false; error: string };

/**
 * Records the caller's signature on the waiver this event calls for (the
 * active waiver for its waiver state + year). Always signs the row the
 * server resolves — the client only says "I agree" and types a name, so it
 * can't sign some other waiver. A signature is immutable: signing again when
 * one already exists is a harmless no-op.
 */
export async function signWaiverAction(
  eventId: number,
  signedName: string,
  agreed: boolean,
): Promise<SignWaiverResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Not authenticated" };
  const userId = claims.claims.sub as string;

  const name = signedName.trim();
  if (!agreed) return { ok: false, error: "You must agree to the waiver to sign it." };
  if (!name) return { ok: false, error: "Type your full name to sign the waiver." };

  const event = await loadWaiverEvent(supabase, eventId);
  if (!event) return { ok: false, error: "Event not found" };

  const requirement = await resolveEventWaiver(supabase, event);
  if (requirement.kind !== "ok") {
    return { ok: false, error: "No waiver is available for this event yet." };
  }

  const { error } = await supabase.from("waiver_signatures").insert({
    user_id: userId,
    waiver_id: requirement.waiver.id,
    signed_name: name,
  });
  // 23505 = already signed this exact waiver; nothing to do.
  if (error && error.code !== "23505") {
    console.error(`[waiver] event ${eventId}: signing failed:`, error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Same as signWaiverAction, but for the VOLUNTEER audience waiver a shift
 * signup calls for (the event's own state/year — see
 * resolveVolunteerWaiverForEvent) rather than the participant one. Backs the
 * inline waiver step in the event page's Volunteer section.
 */
export async function signVolunteerWaiverForEventAction(
  eventId: number,
  signedName: string,
  agreed: boolean,
): Promise<SignWaiverResult> {
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) return { ok: false, error: "Not authenticated" };
  const userId = claims.claims.sub as string;

  const name = signedName.trim();
  if (!agreed) return { ok: false, error: "You must agree to the waiver to sign it." };
  if (!name) return { ok: false, error: "Type your full name to sign the waiver." };

  const event = await loadWaiverEvent(supabase, eventId);
  if (!event) return { ok: false, error: "Event not found" };

  const requirement = await resolveVolunteerWaiverForEvent(supabase, event);
  if (requirement.kind !== "ok") {
    return { ok: false, error: "No volunteer waiver is available for this event yet." };
  }

  const { error } = await supabase.from("waiver_signatures").insert({
    user_id: userId,
    waiver_id: requirement.waiver.id,
    signed_name: name,
  });
  if (error && error.code !== "23505") {
    console.error(`[waiver] event ${eventId}: signing volunteer waiver failed:`, error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type WalkupLookupResult =
  | {
      ok: true;
      info: WaiverInfo;
      /** The matching profile's current value for every registration field,
       * keyed by profile column — or null when there's no profile for that
       * email yet (a brand-new person). */
      profileFields: Record<string, string> | null;
    }
  | { ok: false; error: string };

/**
 * For whoever manages the event (can_manage_event): what the walk-up form should show for this event and email —
 * their waiver situation (nothing, the "Signed for …" line, or the waiver to
 * sign) and what their profile already has for the registration sections, so
 * the form can skip anything already on file, like the RSVP form does.
 * Looked up by email as the admin fills the form in.
 */
export async function walkupLookupAction(
  eventId: number,
  email: string,
): Promise<WalkupLookupResult> {
  const supabase = await createClient();
  const adminCheck = await requireEventManager(supabase, eventId);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  const event = await loadWaiverEvent(supabase, eventId);
  if (!event) return { ok: false, error: "Event not found" };

  // The walk-up usually isn't on any of a chapter lead's events yet, so RLS
  // wouldn't show their profile or signatures — looked up with the
  // service-role client, authorized by the gate above (same as
  // addWalkupRsvpAction). Only the waiver status and registration answers
  // go back to the form.
  let lookup: ReturnType<typeof createAdminClient>;
  try {
    lookup = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }

  const trimmed = email.trim().toLowerCase();
  let profile: Record<string, unknown> | null = null;
  if (trimmed) {
    const { data } = await lookup.from("profiles").select("*").ilike("email", trimmed).maybeSingle();
    profile = data as Record<string, unknown> | null;
  }

  let profileFields: Record<string, string> | null = null;
  if (profile) {
    profileFields = {};
    for (const section of REGISTRATION_SECTIONS) {
      for (const field of section.fields) {
        profileFields[field.key] = profileValueFromColumn(field, profile[field.key]);
      }
    }
  }

  return {
    ok: true,
    info: await waiverInfoForUser(lookup, event, (profile?.id as string | undefined) ?? null),
    profileFields,
  };
}

export type CreateWaiverResult = { ok: true; version: number } | { ok: false; error: string };

/**
 * Adds a new waiver version for a state + year. Never edits an existing row
 * (people have signed it): the version is one higher than the state's
 * current highest, and the newer version supersedes older ones for everyone's
 * next RSVP.
 */
export async function createWaiverVersionAction(input: {
  state: string;
  year: number;
  title: string;
  bodyMarkdown: string;
}): Promise<CreateWaiverResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };

  if (!isWaiverState(input.state)) return { ok: false, error: "Choose Colorado or Georgia" };
  const year = Math.trunc(input.year);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return { ok: false, error: "Enter a valid year" };
  }
  const title = input.title.trim();
  const body = input.bodyMarkdown.trim();
  if (!title) return { ok: false, error: "A title is required" };
  if (!body) return { ok: false, error: "The waiver text is required" };

  // This form only ever manages the participant waiver (see
  // app/protected/admin/waivers/page.tsx) — the volunteer waiver is seeded
  // separately. unique (state, audience, version): retry once if two admins
  // add a version at once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: latest } = await supabase
      .from("waivers")
      .select("version")
      .eq("state", input.state)
      .eq("audience", "participant")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = ((latest?.version as number | undefined) ?? 0) + 1;

    const { error } = await supabase.from("waivers").insert({
      state: input.state,
      audience: "participant",
      year,
      version,
      title,
      body_markdown: body,
    });
    if (!error) return { ok: true, version };
    if (error.code !== "23505") {
      console.error("[waiver] create version failed:", error);
      return { ok: false, error: error.message };
    }
  }
  return { ok: false, error: "Another version was added at the same time — try again." };
}
