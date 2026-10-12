import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { readTwilioWebhook } from "@/lib/twilio";

/**
 * Twilio's delivery updates for each text (queued → sent → delivered, or
 * undelivered / failed), set as the StatusCallback on every send
 * (lib/twilio.ts) and also usable as the Messaging Service's "Delivery
 * Status Callback". Only requests signed by Twilio are accepted.
 */
export async function POST(request: NextRequest) {
  const { valid, params } = await readTwilioWebhook(request);
  if (!valid) return new NextResponse("Invalid signature", { status: 403 });
  const sid = params.MessageSid ?? params.SmsSid;
  const status = params.MessageStatus ?? params.SmsStatus;
  if (!sid || !status) return new NextResponse(null, { status: 204 });
  const { error } = await createAdminClient()
    .from("sms_messages")
    .update({
      status,
      ...(params.ErrorCode ? { error: `Twilio error ${params.ErrorCode}` } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("twilio_sid", sid);
  if (error) console.error("[twilio-status] couldn't record a status:", error.message);
  return new NextResponse(null, { status: 204 });
}
