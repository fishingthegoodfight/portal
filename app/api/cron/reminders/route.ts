import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendReminderEmail, type RsvpEmailEvent } from "@/lib/email/send";
import type { ReminderKind } from "@/lib/email/templates";

/**
 * Daily pre-event reminders (see vercel.json: 15:00 UTC = 9am Mountain).
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 *
 * Windows are by calendar date in each event's own timezone, so an early or
 * late run still lands on the right day, and a missed day is caught up on the
 * next run:
 *   - 1-week: event starts 6–7 local days out
 *   - 1-day:  event starts 0–1 local days out, and hasn't started yet
 * sent_1week_at / sent_1day_at on rsvps guarantee a reminder never goes
 * twice: each send first claims its row with a conditional update.
 *
 * Dev only: ?today=YYYY-MM-DD pretends it's that day (15:00 UTC), and
 * ?dry=1 logs what would be sent without sending or claiming. The secret is
 * still required unless running under `next dev`.
 */

type Outcome = { sent: number; skipped: number; failed: number };

/** YYYY-MM-DD of an instant as seen in a timezone, as a UTC day number. */
function localDayNumber(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(instant);
  const [y, m, d] = parts.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

const EVENT_COLUMNS =
  "id, name, starts_at, ends_at, timezone, location, lead_name, lead_phone, lead_email, custom_email_note, ics_sequence";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isDev = process.env.NODE_ENV === "development";
  const { searchParams } = new URL(request.url);
  const todayParam = isDev ? searchParams.get("today") : null;
  const dry = isDev && searchParams.get("dry") === "1";

  let now = new Date();
  if (todayParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayParam)) {
      return NextResponse.json({ error: "today must be YYYY-MM-DD" }, { status: 400 });
    }
    now = new Date(`${todayParam}T15:00:00Z`);
  }

  const supabase = createAdminClient();

  // Coarse UTC window; the exact per-event-timezone day math happens below.
  const windowEnd = new Date(now.getTime() + 9 * 86_400_000);
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .neq("status", "cancelled")
    .gt("starts_at", now.toISOString())
    .lt("starts_at", windowEnd.toISOString());
  if (eventsError) {
    console.error("[reminders] failed to load events:", eventsError.message);
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  const totals: Record<ReminderKind, Outcome> = {
    "1week": { sent: 0, skipped: 0, failed: 0 },
    "1day": { sent: 0, skipped: 0, failed: 0 },
  };

  for (const event of (events ?? []) as RsvpEmailEvent[]) {
    const daysOut =
      localDayNumber(new Date(event.starts_at), event.timezone) -
      localDayNumber(now, event.timezone);

    let kind: ReminderKind | null = null;
    if (daysOut >= 6 && daysOut <= 7) kind = "1week";
    else if (daysOut >= 0 && daysOut <= 1) kind = "1day";
    if (!kind) {
      console.log(`[reminders] event ${event.id}: ${daysOut} days out, no window — skipped`);
      continue;
    }

    const column = kind === "1week" ? "sent_1week_at" : "sent_1day_at";
    const { data: rsvps, error: rsvpError } = await supabase
      .from("rsvps")
      .select(`id, user_id, ${column}`)
      .eq("event_id", event.id)
      .eq("status", "confirmed")
      .is(column, null);
    if (rsvpError) {
      console.error(`[reminders] event ${event.id}: failed to load RSVPs:`, rsvpError.message);
      continue;
    }
    if (!rsvps?.length) {
      console.log(`[reminders] event ${event.id} (${kind}): nobody left to remind`);
      continue;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", rsvps.map((r) => r.user_id as string));
    const emailById = new Map(
      (profiles ?? []).map((p) => [p.id as string, (p.email as string | null) ?? ""]),
    );

    for (const rsvp of rsvps) {
      const rsvpId = rsvp.id as number | string;
      const email = emailById.get(rsvp.user_id as string);
      if (!email) {
        totals[kind].skipped++;
        console.warn(`[reminders] event ${event.id} rsvp ${rsvpId}: no email on profile — skipped`);
        continue;
      }
      if (dry) {
        totals[kind].skipped++;
        console.log(`[reminders] DRY event ${event.id} (${kind}): would send to ${email}`);
        continue;
      }

      try {
        // Claim first so an overlapping run can't double-send; undo on failure
        // so the next run retries.
        const { data: claimed, error: claimError } = await supabase
          .from("rsvps")
          .update({ [column]: new Date().toISOString() })
          .eq("id", rsvpId)
          .is(column, null)
          .select("id");
        if (claimError) throw claimError;
        if (!claimed?.length) {
          totals[kind].skipped++;
          continue;
        }

        try {
          await sendReminderEmail({ event, toEmail: email, kind });
        } catch (sendErr) {
          await supabase.from("rsvps").update({ [column]: null }).eq("id", rsvpId);
          throw sendErr;
        }
        totals[kind].sent++;
        console.log(`[reminders] event ${event.id} (${kind}): sent to ${email}`);
      } catch (err) {
        totals[kind].failed++;
        console.error(
          `[reminders] event ${event.id} (${kind}) rsvp ${rsvpId} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  console.log("[reminders] done", { now: now.toISOString(), dry, totals });
  return NextResponse.json({ ok: true, now: now.toISOString(), dry, totals });
}
