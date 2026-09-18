import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { sendRsvpCancellationEmail, sendRsvpConfirmationEmail } from "@/lib/email/send";

/**
 * Dev-only helper for testing RSVP email templates against a real event's
 * data without going through a full RSVP/cancel cycle.
 *
 * Usage (development only — 404s otherwise):
 *   /api/dev/test-email?to=you@example.com&event_id=1
 *   /api/dev/test-email?to=you@example.com&event_id=1&kind=cancel
 *   /api/dev/test-email?to=you@example.com&event_id=1&status=waitlisted
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to");
  const eventId = Number(searchParams.get("event_id"));
  const kind = searchParams.get("kind") === "cancel" ? "cancel" : "confirm";
  const status = searchParams.get("status") === "waitlisted" ? "waitlisted" : "confirmed";

  if (!to) {
    return NextResponse.json({ error: "Missing ?to=<email>" }, { status: 400 });
  }
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "Missing or invalid ?event_id=<id>" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from("events")
    .select(
      "id, name, starts_at, ends_at, timezone, location, lead_name, lead_phone, custom_email_note",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error || !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  try {
    if (kind === "cancel") {
      await sendRsvpCancellationEmail({ event, toEmail: to });
    } else {
      await sendRsvpConfirmationEmail({ event, toEmail: to, status });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, kind, status: kind === "confirm" ? status : undefined, to, eventId });
}
