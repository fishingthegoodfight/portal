"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { formatPhoneNumber } from "@/lib/phone";
import { sendMergedAccountsEmail } from "@/lib/email/send";
import { getSiteUrl } from "@/lib/site-url";
import { emailWaitlistOffersByEvent, type EventOfferedSpot } from "@/lib/waitlist";

/**
 * Duplicate profiles (admins only): merging one profile into another, and
 * marking a suggested pair as two different people. admin_merge_people
 * re-checks the caller is an admin and does the whole merge in one
 * transaction; see the 2026-10-23 "Duplicate profiles" entry in
 * schema-changes.sql.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type MergeInput = {
  keepId: string;
  mergeId: string;
  /** The merged profile's email, typed by the admin. */
  confirmEmail: string;
  /** What to take from the merged profile (MergeField.send values). */
  fieldsFromMerged: string[];
  /** Sign in with the merged profile's email and password instead. */
  loginFromMerged: boolean;
  /** Both are volunteers: use the merged one's status, dates and
   * registration answers. */
  volunteerFromMerged: boolean;
  /** Email them that it happened (mergedAccountsEmail). */
  notify: boolean;
};

const joined = (parts: (string | null | undefined)[], separator: string) =>
  parts.map((p) => p?.trim()).filter(Boolean).join(separator) || null;

/** The contact details mergedAccountsEmail lists: what's on the kept
 * profile now. Nothing sensitive (no health, no volunteer record). */
function keptDetails(p: Record<string, string | null>, loginEmail: string) {
  const contact = (name: string | null, relationship: string | null, phone: string | null) =>
    joined([joined([name, relationship && `(${relationship})`], " "), phone], ", ");
  const second = contact(p.emergency_contact_2, p.emergency_contact_2_relationship, p.emergency_phone_2);
  return [
    { label: "Name", value: joined([p.first_name, p.last_name], " ") },
    { label: "Sign-in email", value: loginEmail },
    { label: "Phone", value: joined([p.phone], "") },
    { label: "Home chapter", value: joined([p.chapter], "") },
    {
      label: "Address",
      value: joined(
        [p.address_line1, p.address_line2, joined([p.city, joined([p.state, p.postal_code], " ")], ", ")],
        "\n",
      ),
    },
    { label: "Emergency contact", value: contact(p.emergency_contact, p.emergency_contact_relationship, p.emergency_phone) },
    // Only when there is one: most people have a single contact.
    ...(second ? [{ label: "Second emergency contact", value: second }] : []),
  ];
}

/** Emails both addresses. Returns a warning line on failure; the merge
 * has already happened either way. */
async function notifyMerged(keepId: string, emails: string[], loginEmail: string): Promise<string | null> {
  try {
    const { data: profile, error } = await createAdminClient()
      .from("profiles")
      .select(
        "first_name, last_name, phone, chapter, address_line1, address_line2, city, state, postal_code, emergency_contact, emergency_contact_relationship, emergency_phone, emergency_contact_2, emergency_contact_2_relationship, emergency_phone_2",
      )
      .eq("id", keepId)
      .single();
    if (error) throw error;
    const p = profile as Record<string, string | null>;
    await sendMergedAccountsEmail({
      toEmails: [...new Set(emails.filter(Boolean))],
      firstName: p.first_name?.trim() || null,
      loginEmail,
      otherEmail: emails.find((e) => e.toLowerCase() !== loginEmail.toLowerCase()) ?? "",
      details: keptDetails(p, loginEmail),
      profileUrl: `${getSiteUrl()}/protected/profile`,
    });
    return null;
  } catch (err) {
    console.error(`[person-merge] ${keepId}: the merge email failed:`, err);
    return "The email telling them about the merge couldn't be sent. Let them know another way.";
  }
}

/**
 * Merges and then tidies what the database can't: emails anyone offered a
 * spot the merge freed, emails the person (both addresses) what happened
 * when `notify`, and moves the merged profile's certification files
 * into the kept profile's storage folder (own-folder storage rules). A
 * failed file move is reported, not undone: the merge has happened, and an
 * admin can still open the file where it is.
 */
export async function mergePeopleAction(input: MergeInput): Promise<Result<{ warning: string | null }>> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };

  // Both emails, for the notice: the merged profile's is gone afterwards.
  const { data: before } = await supabase.from("profiles").select("email").in("id", [input.keepId, input.mergeId]);
  const emails = (before ?? []).map((p) => (p.email as string | null) ?? "").filter(Boolean);

  const { data, error } = await supabase.rpc("admin_merge_people", {
    p_keep_id: input.keepId,
    p_merge_id: input.mergeId,
    p_confirm_email: input.confirmEmail,
    p_fields_from_merged: input.fieldsFromMerged,
    p_login_from_merged: input.loginFromMerged,
    p_volunteer_from_merged: input.volunteerFromMerged,
  });
  if (error) return { ok: false, error: error.message };
  const result = data as {
    offered: EventOfferedSpot[];
    certifications: { id: number; file_path: string }[];
    email: string;
  };

  await emailWaitlistOffersByEvent(result.offered);

  const warnings: string[] = [];
  if (result.certifications.length > 0) {
    const admin = createAdminClient();
    const bucket = admin.storage.from("volunteer-certifications");
    let failed = 0;
    for (const cert of result.certifications) {
      const to = `${input.keepId}/${cert.file_path.slice(input.mergeId.length + 1)}`;
      try {
        const { error: moveError } = await bucket.move(cert.file_path, to);
        if (moveError) throw moveError;
        const { error: updateError } = await admin
          .from("volunteer_certifications")
          .update({ file_path: to })
          .eq("id", cert.id);
        if (updateError) throw updateError;
      } catch (err) {
        failed++;
        console.error(`[person-merge] certification ${cert.id}: moving ${cert.file_path} failed:`, err);
      }
    }
    if (failed > 0) {
      warnings.push(`Merged, but ${failed === 1 ? "a certification file" : `${failed} certification files`} couldn't be moved to their folder. Admins can still open ${failed === 1 ? "it" : "them"}; they can't until it's moved (volunteer-certifications/${input.mergeId}/ → ${input.keepId}/ in the Supabase dashboard).`);
    }
  }
  if (input.notify) {
    const emailWarning = await notifyMerged(input.keepId, emails, result.email);
    if (emailWarning) warnings.push(emailWarning);
  }
  return { ok: true, warning: warnings.join(" ") || null };
}

/** "Not the same person": the pair stops being suggested. */
export async function dismissDuplicateAction(userA: string, userB: string): Promise<Result> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };

  const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
  const { error } = await supabase
    .from("person_duplicate_dismissals")
    .upsert({ user_a: a, user_b: b, dismissed_by: gate.actor.userId }, { onConflict: "user_a,user_b", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type MergeCandidate = { id: string; name: string; email: string; phone: string | null; chapter: string | null };

/** Profiles matching `query` (name, email or phone; 2+ characters), for
 * picking the other profile by hand. Leaves out `excludeId`. */
export async function searchMergeCandidatesAction(
  query: string,
  excludeId: string,
): Promise<Result<{ people: MergeCandidate[] }>> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return { ok: false, error: gate.error };

  // Characters that mean something in a PostgREST filter, or in LIKE.
  const q = query.replace(/[,()*%_\\]/g, " ").trim();
  if (q.length < 2) return { ok: true, people: [] };
  const words = q.split(/\s+/).filter(Boolean);
  const filters = [
    `first_name.ilike.%${q}%`,
    `last_name.ilike.%${q}%`,
    `email.ilike.%${q}%`,
    // "Jane Smith": first and last name.
    ...(words.length >= 2
      ? [`and(first_name.ilike.%${words[0]}%,last_name.ilike.%${words.slice(1).join(" ")}%)`]
      : []),
  ];
  const columns = "id, first_name, last_name, email, phone, chapter";
  // Phones are stored formatted ("(303) 555-0100"), and the parentheses
  // can't go inside .or(), so a number is its own query.
  const digits = q.replace(/\D/g, "");
  const [byText, byPhone] = await Promise.all([
    supabase.from("profiles").select(columns).or(filters.join(",")).neq("id", excludeId).limit(10),
    digits.length >= 3 && digits.length === q.replace(/[\s().-]/g, "").length
      ? supabase.from("profiles").select(columns).ilike("phone", `%${formatPhoneNumber(digits)}%`).neq("id", excludeId).limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = byText.error ?? byPhone.error;
  if (error) return { ok: false, error: error.message };
  const rows = new Map([...(byText.data ?? []), ...(byPhone.data ?? [])].map((p) => [p.id as string, p]));
  return {
    ok: true,
    people: [...rows.values()].slice(0, 10).map((p) => ({
      id: p.id as string,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || (p.email as string) || "Unnamed",
      email: (p.email as string | null) ?? "",
      phone: (p.phone as string | null) ?? null,
      chapter: (p.chapter as string | null) ?? null,
    })),
  };
}
