"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEventManager } from "@/lib/admin/require-admin";
import { formatPhoneNumber } from "@/lib/phone";

export type RosterDetailsResult = { ok: true } | { ok: false; error: string };

/**
 * "Edit details" on a roster row: fixes someone's name or phone at check-in
 * (a misspelling, a wrong digit) without a trip to People & roles. Name and
 * phone only.
 *
 * For whoever manages the event (can_manage_event) — the event's own lead
 * included: they're the one at the check-in table when someone says their
 * name is spelled wrong. The person must be on this event (an RSVP or a
 * volunteer shift, any status), so the roster is the only way in. Nobody but the person themselves can update a profile
 * under RLS, so the write goes through the service-role client after those
 * checks — the same pattern as the walk-up fill-in (admin-walkup.ts).
 */
export async function updateRosterPersonDetailsAction(input: {
  eventId: number;
  userId: string;
  firstName: string;
  lastName: string;
  /** Blank leaves the phone on file as it is. */
  phone: string;
}): Promise<RosterDetailsResult> {
  const supabase = await createClient();
  const gate = await requireEventManager(supabase, input.eventId);
  if ("error" in gate) return { ok: false, error: gate.error };

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phone = formatPhoneNumber(input.phone);
  if (!firstName || !lastName) return { ok: false, error: "First and last name are both required" };
  if (phone && phone.replace(/\D/g, "").length !== 10) {
    return { ok: false, error: "Enter the full 10-digit phone number" };
  }

  const { data: rsvp } = await supabase
    .from("rsvps")
    .select("id")
    .eq("event_id", input.eventId)
    .eq("user_id", input.userId)
    .maybeSingle();
  let onEvent = Boolean(rsvp);
  if (!onEvent) {
    const { data: opportunities } = await supabase
      .from("volunteer_opportunities")
      .select("id")
      .eq("event_id", input.eventId);
    const opportunityIds = (opportunities ?? []).map((o) => o.id as number);
    if (opportunityIds.length > 0) {
      const { data: signups } = await supabase
        .from("volunteer_signups")
        .select("id")
        .eq("user_id", input.userId)
        .in("opportunity_id", opportunityIds)
        .limit(1);
      onEvent = (signups ?? []).length > 0;
    }
  }
  if (!onEvent) return { ok: false, error: "That person isn't on this event" };

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }
  const { error: updateError } = await adminClient
    .from("profiles")
    .update({ first_name: firstName, last_name: lastName, ...(phone ? { phone } : {}) })
    .eq("id", input.userId);
  if (updateError) {
    console.error(`[roster-details] event ${input.eventId}: updating ${input.userId} failed:`, updateError);
    return { ok: false, error: updateError.message };
  }
  console.log(
    `[roster-details] event ${input.eventId}: ${gate.actor.userId} edited name/phone of ${input.userId}`,
  );
  return { ok: true };
}
