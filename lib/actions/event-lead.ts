"use server";

import { createClient } from "@/lib/supabase/server";
import { requireEventAdminAccess } from "@/lib/admin/require-admin";
import { loadLeadAccount, type LeadAccount } from "@/lib/admin/lead-account";

export type LeadCandidate = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  chapter: string;
};

export type LeadCandidatesResult = { ok: true; people: LeadCandidate[] } | { ok: false; error: string };

/**
 * The event lead person-picker's search (event_lead_candidates): admins can
 * find anyone; chapter leads find admins, chapter leads, and members of the
 * chapters they lead. At most 10, and only for 2+ characters.
 */
export async function searchLeadCandidatesAction(query: string): Promise<LeadCandidatesResult> {
  const supabase = await createClient();
  const gate = await requireEventAdminAccess(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { data, error } = await supabase.rpc("event_lead_candidates", { p_query: query });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    people: (
      (data ?? []) as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
        role: string;
        chapter: string | null;
      }[]
    ).map((p) => ({
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      email: p.email ?? "",
      phone: p.phone ?? "",
      role: p.role,
      chapter: p.chapter ?? "",
    })),
  };
}

export type LeadAccountStatusResult =
  | {
      ok: true;
      /** The account leadUserId points at — who has access. */
      assigned: LeadAccount | null;
      /** An account the caller may assign whose email is exactly the one
       * typed in the lead email box. */
      emailMatch: LeadAccount | null;
    }
  | { ok: false; error: string };

/**
 * What the lead block needs to say plainly who can manage the event: the
 * assigned account's own name and email (not the free-text ones), and
 * whether the typed lead email belongs to an account that could be assigned.
 * The match goes through event_lead_candidates, so it only ever finds people
 * the caller could have picked from the search anyway.
 */
export async function leadAccountStatusAction(input: {
  leadUserId: string;
  email: string;
}): Promise<LeadAccountStatusResult> {
  const supabase = await createClient();
  const gate = await requireEventAdminAccess(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };

  let assigned: LeadAccount | null = null;
  try {
    assigned = await loadLeadAccount(input.leadUserId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }

  const email = input.email.trim().toLowerCase();
  let emailMatch: LeadAccount | null = null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const { data, error } = await supabase.rpc("event_lead_candidates", { p_query: email });
    if (error) return { ok: false, error: error.message };
    const match = ((data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]).find(
      (p) => (p.email ?? "").trim().toLowerCase() === email,
    );
    if (match) {
      emailMatch = {
        id: match.id,
        name: [match.first_name, match.last_name].filter(Boolean).join(" ").trim() || email,
        email: (match.email ?? "").trim(),
      };
    }
  }
  return { ok: true, assigned, emailMatch };
}
