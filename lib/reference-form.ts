import { createAdminClient } from "@/lib/supabase/admin";
import type { ReferenceSlot } from "@/lib/volunteer-references";

export type ReferenceFormLookup =
  | {
      state: "open";
      applicantName: string;
      referenceName: string;
      slot: ReferenceSlot;
      fishingQuestions: boolean;
    }
  | { state: "submitted" | "closed" | "not_found" };

/** What a reference link may show. Service role: anon can reach nothing
 * about references directly. Deliberately not a server action (this file
 * has no "use server"), so it's only callable from server code — the page
 * and submitReferenceAction. */
export async function lookupReferenceToken(token: string): Promise<ReferenceFormLookup> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { state: "not_found" };
  const { data, error } = await createAdminClient().rpc("reference_form_lookup", { p_token: token });
  const row = ((data ?? []) as {
    state: string;
    applicant_name: string | null;
    reference_name: string | null;
    slot: number | null;
    fishing_questions: boolean | null;
  }[])[0];
  if (error || !row) {
    if (error) console.error("[references] lookup failed:", error.message);
    return { state: "not_found" };
  }
  if (row.state === "open") {
    return {
      state: "open",
      applicantName: row.applicant_name ?? "",
      referenceName: row.reference_name ?? "",
      slot: row.slot === 1 ? 1 : 2,
      fishingQuestions: row.fishing_questions === true,
    };
  }
  return { state: row.state === "submitted" ? "submitted" : row.state === "closed" ? "closed" : "not_found" };
}
