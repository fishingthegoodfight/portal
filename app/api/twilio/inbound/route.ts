import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhoneNumber } from "@/lib/phone";
import { maskPhone, readTwilioWebhook } from "@/lib/twilio";

/** Twilio's default opt-out and opt-in keywords, for when the request
 * doesn't carry OptOutType (Advanced Opt-Out sets it). */
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const START_WORDS = new Set(["START", "YES", "UNSTOP"]);

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/**
 * Texts sent to FTGF's number (the Messaging Service's incoming-message
 * webhook). The Messaging Service itself handles STOP, START and HELP and
 * replies; this mirrors STOP and START onto the profile's SMS consent
 * (profiles.sms_consent) so the portal and Twilio always agree. Anything
 * else is ignored for now. Answers with empty TwiML, so the portal never
 * sends a reply of its own. Only requests signed by Twilio are accepted.
 */
export async function POST(request: NextRequest) {
  const { valid, params } = await readTwilioWebhook(request);
  if (!valid) return new NextResponse("Invalid signature", { status: 403 });

  const word = (params.Body ?? "").trim().toUpperCase();
  const optOut = (params.OptOutType ?? "").toUpperCase();
  const action = optOut === "STOP" || (!optOut && STOP_WORDS.has(word))
    ? "stop"
    : optOut === "START" || (!optOut && START_WORDS.has(word))
      ? "start"
      : null;

  if (action) {
    const digits = (params.From ?? "").replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      // Phones are stored as typed into the mask, "(303) 555-0100"; older
      // ones may be bare digits.
      const forms = [formatPhoneNumber(digits), digits, `1${digits}`, `+1${digits}`];
      const { data, error } = await createAdminClient()
        .from("profiles")
        .update(
          action === "stop"
            ? { sms_consent: false }
            : { sms_consent: true, sms_consent_text: "Replied START to the Fishing the Good Fight texting number" },
        )
        .in("phone", forms)
        .select("id");
      if (error) console.error(`[twilio-inbound] ${action} from ${maskPhone(digits)} not saved:`, error.message);
      else console.log(`[twilio-inbound] ${action} from ${maskPhone(digits)}: ${data?.length ?? 0} profile(s) updated`);
    }
  }
  return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
