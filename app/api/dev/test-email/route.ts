import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  sendAdminChangeNotificationEmail,
  sendEventCancellationEmail,
  sendEventRestoredEmail,
  sendEventUpdateEmail,
  sendRsvpCancellationEmail,
  sendRsvpConfirmationEmail,
  sendLeadParticipantCancelledEmail,
  sendWaitlistOfferEmail,
  sendWaitlistOfferExpiredEmail,
} from "@/lib/email/send";

/**
 * Dev-only helper for testing email templates against a real event's data
 * without going through a full RSVP/edit/cancel cycle.
 *
 * Usage (development only — 404s otherwise):
 *   /api/dev/test-email?to=you@example.com&event_id=1
 *   /api/dev/test-email?to=you@example.com&event_id=1&kind=cancel
 *   /api/dev/test-email?to=you@example.com&event_id=1&status=waitlisted
 *   /api/dev/test-email?to=you@example.com&event_id=1&kind=event-cancel&reason=Snow
 *   /api/dev/test-email?to=you@example.com&event_id=1&kind=event-update
 *   /api/dev/test-email?to=you@example.com&event_id=1&kind=event-restore
 *   /api/dev/test-email?event_id=1&kind=admin-notify  (uses ADMIN_NOTIFICATION_EMAILS, ignores ?to=)
 *   /api/dev/test-email?to=you@example.com&event_id=1&kind=waitlist-offer
 *   /api/dev/test-email?to=you@example.com&event_id=1&kind=waitlist-expired[&reason=capacity]
 *   /api/dev/test-email?event_id=1&kind=lead-cancel[&offered=1]  (goes to the event's lead_email, ignores ?to=)
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to");
  const eventId = Number(searchParams.get("event_id"));
  const kind = searchParams.get("kind") ?? "confirm";
  const status = searchParams.get("status") === "waitlisted" ? "waitlisted" : "confirmed";
  const reason = searchParams.get("reason") ?? "Testing the cancellation email.";

  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "Missing or invalid ?event_id=<id>" }, { status: 400 });
  }
  if (kind !== "admin-notify" && kind !== "lead-cancel" && !to) {
    return NextResponse.json({ error: "Missing ?to=<email>" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from("events")
    .select(
      "id, name, starts_at, ends_at, timezone, location, lead_name, lead_phone, lead_email, custom_email_note, virtual_link, virtual_access_notes, ics_sequence",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error || !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  try {
    switch (kind) {
      case "cancel":
        await sendRsvpCancellationEmail({ event, toEmail: to! });
        break;
      case "event-cancel":
        await sendEventCancellationEmail({ event, toEmail: to!, reason });
        break;
      case "event-update":
        await sendEventUpdateEmail({ event, toEmail: to! });
        break;
      case "event-restore":
        await sendEventRestoredEmail({ event, toEmail: to! });
        break;
      case "waitlist-offer":
        await sendWaitlistOfferEmail({
          event,
          toEmail: to!,
          expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        });
        break;
      case "waitlist-expired":
        await sendWaitlistOfferExpiredEmail({
          event,
          toEmail: to!,
          reason: searchParams.get("reason") === "capacity" ? "capacity" : undefined,
        });
        break;
      case "lead-cancel":
        if (!event.lead_email) {
          return NextResponse.json({ error: "Event has no lead_email" }, { status: 400 });
        }
        await sendLeadParticipantCancelledEmail({
          event,
          cancelledBy: "Test Participant <test@example.com>",
          offeredTo: searchParams.get("offered") ? ["Next Person"] : [],
        });
        break;
      case "admin-notify":
        await sendAdminChangeNotificationEmail({
          action: "edited",
          actorLabel: "Test Admin <test@example.com>",
          eventName: event.name,
          eventId: event.id,
          diff: [{ label: "Location", before: "Old location", after: "New location" }],
          reason: null,
        });
        break;
      default:
        await sendRsvpConfirmationEmail({ event, toEmail: to!, status });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, kind, status: kind === "confirm" ? status : undefined, to, eventId });
}
