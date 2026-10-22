import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { toE164 } from "@/lib/phone";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Twilio groundwork (backlog item 7, section 5; 2026-10-12 "Texting" entry
 * in schema-changes.sql). One way to send a text — sendSms, through FTGF's
 * Messaging Service (10DLC) — and the checks for Twilio's webhooks. Bulk
 * texting isn't built yet (backlog).
 *
 * Credentials come from TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_MESSAGING_SERVICE_SID (Vercel, and .env.local). Never log them:
 * errors here name the missing variable, never a value.
 */

const API = "https://api.twilio.com/2010-04-01";

function credentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!accountSid) throw new Error("TWILIO_ACCOUNT_SID is not set");
  if (!authToken) throw new Error("TWILIO_AUTH_TOKEN is not set");
  if (!messagingServiceSid) throw new Error("TWILIO_MESSAGING_SERVICE_SID is not set");
  return { accountSid, authToken, messagingServiceSid };
}

/** Where Twilio reports each text's delivery (set on every send). */
function twilioStatusCallbackUrl(): string {
  return `${getSiteUrl()}/api/twilio/status`;
}

export type SmsResult = { ok: true; sid: string; status: string } | { ok: false; error: string };

/**
 * Texts one person, through the Messaging Service. Refuses anyone who
 * hasn't consented (profiles.sms_consent) or has no usable US number.
 * Every attempt, refused ones included, is a row in sms_messages; Twilio's
 * delivery updates arrive later at /api/twilio/status.
 */
export async function sendSms({
  userId,
  body,
  senderId,
}: {
  userId: string;
  body: string;
  /** Who sent it (null for an automatic text). */
  senderId: string | null;
}): Promise<SmsResult> {
  const admin = createAdminClient();
  const text = body.trim();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("phone, sms_consent, access_removed_at")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) return { ok: false, error: `Couldn't load the profile: ${profileError.message}` };
  const to = toE164(profile?.phone as string | null);

  const refuse = async (reason: string): Promise<SmsResult> => {
    await admin.from("sms_messages").insert({
      user_id: userId,
      to_phone: to,
      body: text,
      sender_id: senderId,
      status: "refused",
      error: reason,
    });
    return { ok: false, error: reason };
  };
  if (!text) return refuse("The message is empty.");
  if (!profile) return refuse("No such person.");
  if (profile.access_removed_at) return refuse("They've been removed from the portal.");
  if (!profile.sms_consent) return refuse("They haven't agreed to texts (SMS consent is off).");
  if (!to) return refuse("Their profile has no usable US mobile number.");

  let creds: ReturnType<typeof credentials>;
  try {
    creds = credentials();
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err));
  }

  const { data: row, error: insertError } = await admin
    .from("sms_messages")
    .insert({ user_id: userId, to_phone: to, body: text, sender_id: senderId, status: "sending" })
    .select("id")
    .single();
  if (insertError || !row) return { ok: false, error: `Couldn't record the text: ${insertError?.message ?? "unknown"}` };

  const finish = (update: Record<string, unknown>) =>
    admin
      .from("sms_messages")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", row.id);

  try {
    const response = await fetch(`${API}/Accounts/${creds.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        MessagingServiceSid: creds.messagingServiceSid,
        To: to,
        Body: text,
        StatusCallback: twilioStatusCallbackUrl(),
      }),
    });
    const json = (await response.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
    if (!response.ok || !json.sid) {
      const error = `Twilio ${json.code ?? response.status}: ${json.message ?? response.statusText}`;
      await finish({ status: "failed", error });
      return { ok: false, error };
    }
    await finish({ status: json.status ?? "queued", twilio_sid: json.sid });
    return { ok: true, sid: json.sid, status: json.status ?? "queued" };
  } catch (err) {
    const error = `Couldn't reach Twilio: ${err instanceof Error ? err.message : String(err)}`;
    await finish({ status: "failed", error });
    return { ok: false, error };
  }
}

/**
 * Twilio's request signature (X-Twilio-Signature): HMAC-SHA1, keyed with the
 * auth token, of the full URL Twilio called followed by every POST
 * parameter's name and value in name order, base64.
 */
function isValidTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join("");
  const expected = Buffer.from(createHmac("sha1", authToken).update(data, "utf8").digest("base64"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * A webhook's form parameters, and whether Twilio really sent it. The URL
 * Twilio signed is checked as this request arrived and as the site URL
 * (NEXT_PUBLIC_SITE_URL), in case the console has the other domain.
 */
export async function readTwilioWebhook(
  request: NextRequest,
): Promise<{ valid: boolean; params: Record<string, string> }> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const { pathname, search } = request.nextUrl;
  const urls = [...new Set([request.url, `${getSiteUrl()}${pathname}${search}`])];
  return { valid: urls.some((url) => isValidTwilioSignature(url, params, signature)), params };
}

/** "•••-•••-0100" — enough to recognise a number in a log line. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : "•••";
}
