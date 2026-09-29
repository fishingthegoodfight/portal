"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { emailWaitlistOffers, type OfferedSpot } from "@/lib/waitlist";
import type { PersonRemovalCounts, PersonRemovalPreview } from "@/lib/person-removal";

/**
 * People & roles → "Remove person…" (admins only). Each database function
 * re-checks the caller is an admin, refuses the caller themselves and the
 * last admin, and does all its work in one transaction; see the 2026-09-29
 * "Removing a person" entry in schema-changes.sql. Every action is recorded
 * in person_removal_log by the function itself.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type RawOffer = OfferedSpot & { event_id: number };

/** Emails "a spot opened" to whoever was offered a spot the person gave up,
 * one batch per event. Never throws (emailWaitlistOffers logs failures). */
async function emailOffers(offers: RawOffer[] | null | undefined) {
  const byEvent = new Map<number, OfferedSpot[]>();
  for (const o of offers ?? []) {
    const list = byEvent.get(o.event_id) ?? [];
    list.push({ user_id: o.user_id, expires_at: o.expires_at });
    byEvent.set(o.event_id, list);
  }
  for (const [eventId, list] of byEvent) await emailWaitlistOffers(eventId, list);
}

export async function personRemovalPreviewAction(
  userId: string,
): Promise<Result<{ preview: PersonRemovalPreview }>> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { data, error } = await supabase.rpc("admin_person_removal_preview", { p_user_id: userId });
  if (error) return { ok: false, error: error.message };
  const raw = data as {
    email: string | null;
    name: string | null;
    role: string;
    is_self: boolean;
    is_last_admin: boolean;
    access_removed_at: string | null;
    counts: PersonRemovalCounts;
  };
  return {
    ok: true,
    preview: {
      email: raw.email ?? "",
      name: raw.name,
      role: raw.role,
      isSelf: raw.is_self,
      isLastAdmin: raw.is_last_admin,
      accessRemovedAt: raw.access_removed_at,
      counts: raw.counts,
    },
  };
}

/** Longest reason the database accepts (person_removal_log.reason). */
const REASON_MAX = 1000;

function checkReason(reason: string): string | null {
  return reason.trim().length > REASON_MAX ? `Keep the reason under ${REASON_MAX} characters` : null;
}

/** Disables their login and takes them out of everything current; their
 * history stays. `reason` is optional, kept in the removal log. */
export async function removePersonAccessAction(userId: string, reason: string): Promise<Result> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };

  const reasonError = checkReason(reason);
  if (reasonError) return { ok: false, error: reasonError };

  const { data, error } = await supabase.rpc("admin_remove_person_access", {
    p_user_id: userId,
    p_reason: reason.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  await emailOffers((data as { offered?: RawOffer[] } | null)?.offered);
  return { ok: true };
}

export async function restorePersonAccessAction(userId: string): Promise<Result> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await supabase.rpc("admin_restore_person_access", { p_user_id: userId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Deletes the person and everything attached to them. `typedEmail` must be
 * theirs (admin_delete_person checks it too); `reason` is optional, kept in
 * the removal log. Their certification files are
 * removed from storage afterwards — only the storage API can delete those —
 * and a failure there is reported, not undone: the person is already gone.
 */
export async function deletePersonAction(
  userId: string,
  typedEmail: string,
  reason: string,
): Promise<Result<{ warning: string | null }>> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };
  const reasonError = checkReason(reason);
  if (reasonError) return { ok: false, error: reasonError };

  const { data, error } = await supabase.rpc("admin_delete_person", {
    p_user_id: userId,
    p_confirm_email: typedEmail,
    p_reason: reason.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  const result = data as { counts: PersonRemovalCounts; offered: RawOffer[] };

  await emailOffers(result.offered);

  let warning: string | null = null;
  if (result.counts.certification_files > 0) {
    try {
      const bucket = createAdminClient().storage.from("volunteer-certifications");
      const { data: files, error: listError } = await bucket.list(userId, { limit: 1000 });
      if (listError) throw listError;
      const paths = (files ?? []).map((f) => `${userId}/${f.name}`);
      if (paths.length > 0) {
        const { error: removeError } = await bucket.remove(paths);
        if (removeError) throw removeError;
      }
    } catch (err) {
      console.error(`[person-delete] ${userId}: removing certification files failed:`, err);
      warning = `They were deleted, but their certification files couldn't be removed from storage (volunteer-certifications/${userId}/). Delete that folder in the Supabase dashboard.`;
    }
  }
  return { ok: true, warning };
}
