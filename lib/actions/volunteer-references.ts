"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendReferenceRequestEmail } from "@/lib/email/send";
import { lookupReferenceToken, referenceChapterOptions } from "@/lib/reference-form";
import {
  referenceAnswersPayload,
  referenceByDate,
  referenceErrors,
  type ReferenceInput,
  type ReferenceSlot,
} from "@/lib/volunteer-references";

/**
 * Reference checks (phase 3). Link tokens are only ever handled here, with
 * the service role: a reviewer's own client can't read them (they're in
 * volunteer_reference_tokens, service-role only), so no reviewer can open a
 * link and answer as the reference. Each reviewer action checks the
 * signed-in user with their own client first, then does the work with the
 * service role, passing them through as the actor.
 */

export type ReferenceActionResult = { ok: true; warning?: string } | { ok: false; error: string };

type SentRequest = { request_id: number; slot: ReferenceSlot; name: string; email: string; token: string };

async function signedInReviewer(applicationId: number): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims) return { error: "Not authenticated" };
  const { data: canReview } = await supabase.rpc("can_review_application", { p_application_id: applicationId });
  if (!canReview) return { error: "You can't act on this application" };
  return { userId: claims.claims.sub as string };
}

function adminClient(): ReturnType<typeof createAdminClient> | { error: string } {
  try {
    return createAdminClient();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Admin client unavailable" };
  }
}

async function emailRequests(requests: SentRequest[], applicantName: string, kind: "request" | "reminder") {
  const failed: string[] = [];
  const byDate = referenceByDate(new Date());
  for (const r of requests) {
    try {
      await sendReferenceRequestEmail({
        toEmail: r.email,
        referenceName: r.name,
        applicantName,
        slot: r.slot,
        token: r.token,
        kind,
        byDate,
      });
    } catch (err) {
      console.error(`[references] emailing request ${r.request_id} (${r.email}) failed:`, err);
      failed.push(r.name);
    }
  }
  return failed;
}

function emailWarning(failed: string[]): string | undefined {
  return failed.length > 0
    ? `Saved, but the email to ${failed.join(" and ")} didn't go. Use "Send a reminder now" to try again.`
    : undefined;
}

/** "Send reference requests": both references, Screened -> References out.
 * The database re-checks that the latest call moved it forward. */
export async function sendReferenceRequestsAction(applicationId: number): Promise<ReferenceActionResult> {
  const supabase = await createClient();
  const reviewer = await signedInReviewer(applicationId);
  if ("error" in reviewer) return { ok: false, error: reviewer.error };
  const { data: canSend } = await supabase.rpc("can_send_reference_requests", { p_application_id: applicationId });
  if (!canSend) return { ok: false, error: "Reference requests can't be sent for this application right now." };

  const admin = adminClient();
  if ("error" in admin) return { ok: false, error: admin.error };
  const { data, error } = await admin.rpc("reference_requests_send", {
    p_application_id: applicationId,
    p_actor: reviewer.userId,
  });
  if (error) return { ok: false, error: error.message };
  const { data: app } = await admin.from("volunteer_applications").select("full_name").eq("id", applicationId).single();

  const failed = await emailRequests((data ?? []) as SentRequest[], (app?.full_name as string) ?? "An applicant", "request");
  await admin.from("volunteer_application_events").update({ emailed: failed.length === 0 })
    .eq("application_id", applicationId).eq("action", "references_requested");
  return { ok: true, warning: emailWarning(failed) };
}

/** "Send a reminder now": emails the same link again. Doesn't count toward
 * the three automatic reminders or change their schedule. */
export async function sendReferenceReminderNowAction(requestId: number): Promise<ReferenceActionResult> {
  const admin = adminClient();
  if ("error" in admin) return { ok: false, error: admin.error };
  const { data: request } = await admin
    .from("volunteer_reference_requests")
    .select("id, application_id, slot, name, email, manual_reminders_sent, replaced_at, submitted_at, volunteer_applications!inner(full_name, status)")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, error: "Reference request not found" };
  const reviewer = await signedInReviewer(request.application_id as number);
  if ("error" in reviewer) return { ok: false, error: reviewer.error };

  const app = request.volunteer_applications as unknown as { full_name: string; status: string };
  if (request.replaced_at || request.submitted_at || app.status !== "references_out") {
    return { ok: false, error: "That reference isn't waiting on an answer." };
  }
  const { data: tokenRow } = await admin
    .from("volunteer_reference_tokens")
    .select("token")
    .eq("request_id", requestId)
    .is("used_at", null)
    .maybeSingle();
  if (!tokenRow) return { ok: false, error: "That reference's link is no longer live." };

  const failed = await emailRequests(
    [{ request_id: requestId, slot: request.slot as ReferenceSlot, name: request.name as string, email: request.email as string, token: tokenRow.token as string }],
    app.full_name,
    "reminder",
  );
  if (failed.length > 0) return { ok: false, error: "The reminder email didn't go. Try again in a minute." };

  await admin
    .from("volunteer_reference_requests")
    .update({
      manual_reminders_sent: (request.manual_reminders_sent as number) + 1,
      last_manual_reminder_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  await admin.from("volunteer_application_events").insert({
    application_id: request.application_id,
    action: "reference_reminder_sent",
    note: `Reference ${request.slot}: ${request.name} — reminder sent by hand`,
    actor: reviewer.userId,
    emailed: true,
  });
  return { ok: true };
}

/** "Replace this reference": retires the unanswered one (its link stops
 * working) and sends a fresh request, on a fresh schedule, to someone new.
 * A replacement for reference 1 must be a current FTGF volunteer. */
export async function replaceReferenceAction(
  requestId: number,
  input: { name: string; email: string; relationship: string },
): Promise<ReferenceActionResult> {
  const admin = adminClient();
  if ("error" in admin) return { ok: false, error: admin.error };
  const { data: request } = await admin
    .from("volunteer_reference_requests")
    .select("application_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, error: "Reference request not found" };
  const applicationId = request.application_id as number;
  const reviewer = await signedInReviewer(applicationId);
  if ("error" in reviewer) return { ok: false, error: reviewer.error };

  const { data, error } = await admin.rpc("reference_request_replace", {
    p_request_id: requestId,
    p_name: input.name,
    p_email: input.email,
    p_relationship: input.relationship,
    p_actor: reviewer.userId,
  });
  if (error) return { ok: false, error: error.message };
  const { data: app } = await admin.from("volunteer_applications").select("full_name").eq("id", applicationId).single();
  const failed = await emailRequests((data ?? []) as SentRequest[], (app?.full_name as string) ?? "An applicant", "request");
  return { ok: true, warning: emailWarning(failed) };
}

/** An admin: both references are in and have been read (before approval). */
export async function markReferencesReviewedAction(applicationId: number): Promise<ReferenceActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("references_mark_reviewed", { p_application_id: applicationId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ---- The public form ------------------------------------------------------------------

export type SubmitReferenceResult = { ok: true } | { ok: false; error: string; closed?: boolean };

/** Submit a reference's answers through their link — once. */
export async function submitReferenceAction(token: string, input: ReferenceInput): Promise<SubmitReferenceResult> {
  const lookup = await lookupReferenceToken(token);
  if (lookup.state === "submitted") return { ok: true };
  if (lookup.state !== "open") {
    return { ok: false, closed: true, error: "This link isn't active any more, so we can't take answers through it." };
  }
  const shape = { slot: lookup.slot, fishingQuestions: lookup.fishingQuestions };
  const errors = referenceErrors(input, shape, await referenceChapterOptions());
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const { data, error } = await createAdminClient().rpc("reference_form_submit", {
    p_token: token,
    p_answers: referenceAnswersPayload(input, shape),
  });
  if (error) {
    console.error("[references] submit failed:", error.message);
    return { ok: false, error: "Your answers couldn't be saved. Nothing you entered was lost — please try again." };
  }
  if (data === "submitted" || data === "submitted_already") return { ok: true };
  return { ok: false, closed: true, error: "This link isn't active any more, so we can't take answers through it." };
}
