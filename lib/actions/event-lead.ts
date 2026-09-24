"use server";

import { createClient } from "@/lib/supabase/server";
import { requireEventAdminAccess } from "@/lib/admin/require-admin";

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
