"use server";

import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chapterEmailLinks, eventMergeValues, processBulkEmailQueue } from "@/lib/bulk-email";
import { applyMerge, BODY_MAX, signatureLines, SUBJECT_MAX, type BulkEmailSource } from "@/lib/bulk-email-text";
import { sendChapterMessageEmail } from "@/lib/email/send";
import { ensureUnsubscribeToken } from "@/lib/email-preferences";

/**
 * The compose screen's server side (components/email-composer.tsx). Who may
 * email whom is decided in the database — bulk_email_check and
 * create_bulk_email, called as the signed-in person — never here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECIPIENTS = 5000;
/** How long a send keeps going out in the background of the request that
 * queued it; the every-5-minutes job sends the rest. */
const IN_REQUEST_MS = 240_000;

type Failure = { ok: false; error: string };

export type RecipientCheck = {
  userId: string;
  name: string;
  email: string | null;
  chapter: string | null;
  firstName: string | null;
  /** Why they won't get it; null = they will. */
  excluded: string | null;
};

export type ComposeTemplate = { id: number; chapter: string | null; name: string; subject: string; body: string };

function cleanIds(ids: string[]): string[] | null {
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length > MAX_RECIPIENTS || unique.some((id) => !UUID.test(id))) return null;
  return unique;
}

/** A database refusal (raise exception) reads as written. */
const dbError = (message: string) => message;

/** The recipient list as the database sees it, how many more can go out
 * today, and who's sending (for the signature). */
export async function checkRecipientsAction(input: {
  source: BulkEmailSource;
  eventId: number | null;
  userIds: string[];
}): Promise<
  | { ok: true; recipients: RecipientCheck[]; headroom: number; sender: { name: string; email: string | null }; isAdmin: boolean }
  | Failure
> {
  const ids = cleanIds(input.userIds);
  if (!ids) return { ok: false, error: `Choose between 1 and ${MAX_RECIPIENTS} people.` };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub as string | undefined;
  if (!me) return { ok: false, error: "Sign in again." };

  const [check, headroom, profile] = await Promise.all([
    supabase.rpc("bulk_email_check", { p_source: input.source, p_event_id: input.eventId, p_user_ids: ids }),
    supabase.rpc("email_headroom"),
    supabase.from("profiles").select("first_name, last_name, email, role").eq("id", me).maybeSingle(),
  ]);
  if (check.error) return { ok: false, error: dbError(check.error.message) };
  const rows = (check.data ?? []) as {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    chapter: string | null;
    excluded: string | null;
  }[];
  const name = [profile.data?.first_name, profile.data?.last_name].filter(Boolean).join(" ").trim();
  return {
    ok: true,
    recipients: rows
      .map((r) => ({
        userId: r.user_id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.email || "Unnamed",
        email: r.email,
        chapter: r.chapter,
        firstName: r.first_name,
        excluded: r.excluded,
      }))
      .sort((a, b) => Number(a.excluded != null) - Number(b.excluded != null) || a.name.localeCompare(b.name)),
    headroom: typeof headroom.data === "number" ? headroom.data : 0,
    sender: { name: name || (profile.data?.email as string | null) || "A Fishing the Good Fight leader", email: (profile.data?.email as string | null) ?? null },
    isAdmin: profile.data?.role === "admin",
  };
}

function validateMessage(subject: string, body: string): string | null {
  if (!subject.trim()) return "Add a subject.";
  if (subject.length > SUBJECT_MAX) return `Keep the subject to ${SUBJECT_MAX} characters.`;
  if (!body.trim()) return "Write a message.";
  if (body.length > BODY_MAX) return `Keep the message to ${BODY_MAX.toLocaleString()} characters.`;
  return null;
}

/** "Send me a test": one copy to the sender, merge fields filled from
 * `sampleUserId` (the first person on the list), checked the same way. */
export async function sendTestEmailAction(input: {
  source: BulkEmailSource;
  chapter: string | null;
  eventId: number | null;
  subject: string;
  body: string;
  sampleUserId: string;
}): Promise<{ ok: true; to: string } | Failure> {
  const problem = validateMessage(input.subject, input.body);
  if (problem) return { ok: false, error: problem };
  const check = await checkRecipientsAction({ source: input.source, eventId: input.eventId, userIds: [input.sampleUserId] });
  if (!check.ok) return check;
  const sample = check.recipients[0];
  if (!sample || sample.excluded === "Not in your chapters" || sample.excluded === "Not on this event") {
    return { ok: false, error: "You can't email that person." };
  }
  if (!check.sender.email) return { ok: false, error: "Your profile has no email address to send the test to." };
  if (check.headroom < 1) return { ok: false, error: "The shared daily email limit has been reached. Try again later." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub as string;
  const event = await eventMergeValues(createAdminClient(), input.source === "roster" ? input.eventId : null);
  const values = { ...event, first_name: sample.firstName, chapter: sample.chapter };
  try {
    const links = chapterEmailLinks(await ensureUnsubscribeToken(me));
    await sendChapterMessageEmail({
      toEmail: check.sender.email,
      replyTo: check.sender.email,
      oneClickUrl: links.oneClickUrl,
      content: {
        subject: applyMerge(input.subject.trim(), values),
        body: applyMerge(input.body, values),
        signature: signatureLines(check.sender.name, input.chapter),
        stopUrl: links.stopUrl,
        test: true,
      },
    });
  } catch (err) {
    return { ok: false, error: `The test didn't send: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, to: check.sender.email };
}

/** Queues the send (the database checks access, opt-outs and the daily
 * limit, all or nothing) and starts sending it in the background. */
export async function sendBulkEmailAction(input: {
  source: BulkEmailSource;
  chapter: string | null;
  eventId: number | null;
  audience: string;
  subject: string;
  body: string;
  userIds: string[];
}): Promise<{ ok: true; id: number } | Failure> {
  const startedAt = Date.now();
  const problem = validateMessage(input.subject, input.body);
  if (problem) return { ok: false, error: problem };
  const ids = cleanIds(input.userIds);
  if (!ids) return { ok: false, error: `Choose between 1 and ${MAX_RECIPIENTS} people.` };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_bulk_email", {
    p_source: input.source,
    p_chapter: input.chapter,
    p_event_id: input.source === "roster" ? input.eventId : null,
    p_audience: input.audience,
    p_subject: input.subject.trim(),
    p_body: input.body,
    p_user_ids: ids,
  });
  if (error) return { ok: false, error: dbError(error.message) };
  after(async () => {
    try {
      await processBulkEmailQueue(startedAt + IN_REQUEST_MS);
    } catch (err) {
      console.error("[bulk-email] background send failed:", err);
    }
  });
  return { ok: true, id: data as number };
}

/** Templates offered for a chapter: that chapter's, and every chapter's
 * (chapter null). The database only returns what this person may see. */
export async function listTemplatesAction(chapter: string | null): Promise<{ ok: true; templates: ComposeTemplate[] } | Failure> {
  const supabase = await createClient();
  let query = supabase.from("email_templates").select("id, chapter, name, subject, body").order("name");
  query = chapter ? query.or(`chapter.is.null,chapter.eq."${chapter.replace(/"/g, "")}"`) : query.is("chapter", null);
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, templates: (data ?? []) as ComposeTemplate[] };
}

/** Saves a template: new (no id) or an edit. `chapter` null = every
 * chapter's, which only admins may do (the database refuses anyone else). */
export async function saveTemplateAction(input: {
  id: number | null;
  chapter: string | null;
  name: string;
  subject: string;
  body: string;
}): Promise<{ ok: true; template: ComposeTemplate } | Failure> {
  const name = input.name.trim();
  if (!name || name.length > 80) return { ok: false, error: "Give the template a name (up to 80 characters)." };
  const problem = validateMessage(input.subject, input.body);
  if (problem) return { ok: false, error: problem };
  const supabase = await createClient();
  const row = { chapter: input.chapter, name, subject: input.subject.trim(), body: input.body };
  const { data, error } = input.id
    ? await supabase.from("email_templates").update(row).eq("id", input.id).select("id, chapter, name, subject, body").maybeSingle()
    : await supabase.from("email_templates").insert(row).select("id, chapter, name, subject, body").maybeSingle();
  if (error) {
    if (error.code === "42501") return { ok: false, error: "You can't save templates for that chapter." };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "You can't edit that template." };
  return { ok: true, template: data as ComposeTemplate };
}

export async function deleteTemplateAction(id: number): Promise<{ ok: true } | Failure> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("email_templates").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "You can't delete that template." };
  return { ok: true };
}
