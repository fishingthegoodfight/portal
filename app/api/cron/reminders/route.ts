import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendReminderEmail,
  sendVolunteerReminderEmail,
  type RsvpEmailEvent,
  type VolunteerShiftEmailContext,
} from "@/lib/email/send";
import type { ReminderKind } from "@/lib/email/templates";
import { runOpportunitiesEmail, type OpportunitiesRunSummary } from "@/lib/volunteer-opportunities-email";
import { runWalkupWelcomeEmails, type WalkupWelcomeRunSummary } from "@/lib/walkup-welcome";
import { runMembersOutreachEmail, type MembersEmailRunSummary } from "@/lib/members-outreach-email";

// The volunteer opportunities email runs here too and, on a send day, sends
// one email per volunteer, spaced out — give it room. 300s is Vercel
// Hobby's maximum with Fluid compute (on by default); without Fluid compute
// Hobby is capped at 60s. Either way the email job stops itself
// OPPORTUNITIES_MARGIN_MS before this limit, and anyone it didn't reach
// gets theirs on the next day's run.
export const maxDuration = 300;
const OPPORTUNITIES_MARGIN_MS = 30_000;

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
 * First, the welcome email for accounts created at a walk-up
 * (lib/walkup-welcome.ts): the morning after the event — 15:00 UTC is 9am
 * Mountain (8am in winter), 11am Eastern. Small and time-sensitive, so it
 * goes before everything else; a failure there is logged and doesn't stop
 * the rest.
 *
 * Then, in the same run, the every-other-week volunteer opportunities email
 * (lib/volunteer-opportunities-email.ts), which only sends with it turned
 * on in Setup, on a send day — or on the few days after one, to anyone a
 * cut-off run didn't reach. Vercel Hobby allows daily crons only, so the
 * schedule lives there, not in vercel.json. A failure there is logged and
 * doesn't affect the reminders above.
 *
 * Then the weekly Members outreach email (lib/members-outreach-email.ts):
 * each chapter's member engagement lead, and the admins' summary, on the
 * weekday chosen in Setup → Members. Also logged-and-carry-on on failure.
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
  "id, name, starts_at, ends_at, timezone, location, lead_name, lead_phone, lead_email, custom_email_note, occurrence_note, virtual_link, virtual_access_notes, ics_sequence";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
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

  let walkupWelcome: WalkupWelcomeRunSummary | { error: string };
  try {
    walkupWelcome = await runWalkupWelcomeEmails(supabase, { now, dry });
    for (const failure of walkupWelcome.failed) console.error("[walkup-welcome]", failure);
    console.log("[walkup-welcome] done", {
      due: walkupWelcome.due,
      sent: walkupWelcome.sent.length,
      failed: walkupWelcome.failed.length,
    });
  } catch (err) {
    console.error("[walkup-welcome] failed:", err);
    walkupWelcome = { error: err instanceof Error ? err.message : String(err) };
  }

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
    return NextResponse.json({ error: eventsError.message, walkupWelcome }, { status: 500 });
  }

  const totals: Record<ReminderKind, Outcome> = {
    "1week": { sent: 0, skipped: 0, failed: 0 },
    "1day": { sent: 0, skipped: 0, failed: 0 },
  };
  // Separate from the participant totals above — a distinct email, same cron
  // pass and event-level day-out window (see the module comment).
  const volunteerTotals: Record<ReminderKind, Outcome> = {
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

    // Volunteer shift reminders — same event-level kind/window computed
    // above, a separate email per confirmed shift signup (not per RSVP).
    const { data: opportunities } = await supabase
      .from("volunteer_opportunities")
      .select("id, role, description, what_to_bring, shift_start, shift_end")
      .eq("event_id", event.id)
      .is("cancelled_at", null);

    if (opportunities?.length) {
      const vColumn = kind === "1week" ? "sent_1week_at" : "sent_1day_at";
      const { data: signups, error: signupError } = await supabase
        .from("volunteer_signups")
        .select(`id, opportunity_id, user_id, ${vColumn}`)
        .in(
          "opportunity_id",
          opportunities.map((o) => o.id),
        )
        .eq("status", "confirmed")
        .is(vColumn, null);

      if (signupError) {
        console.error(
          `[reminders] event ${event.id}: failed to load volunteer signups:`,
          signupError.message,
        );
      } else if (signups?.length) {
        const { data: vProfiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in(
            "id",
            signups.map((s) => s.user_id as string),
          );
        const vEmailById = new Map(
          (vProfiles ?? []).map((p) => [p.id as string, (p.email as string | null) ?? ""]),
        );
        const opportunityById = new Map(opportunities.map((o) => [o.id as number, o]));

        for (const signup of signups) {
          const signupId = signup.id as number;
          const opportunity = opportunityById.get(signup.opportunity_id as number);
          const email = vEmailById.get(signup.user_id as string);
          if (!opportunity || !email) {
            volunteerTotals[kind].skipped++;
            console.warn(
              `[reminders] volunteer event ${event.id} signup ${signupId}: missing opportunity or email — skipped`,
            );
            continue;
          }
          if (dry) {
            volunteerTotals[kind].skipped++;
            console.log(`[reminders] DRY volunteer event ${event.id} (${kind}): would send to ${email}`);
            continue;
          }

          try {
            const { data: claimed, error: claimError } = await supabase
              .from("volunteer_signups")
              .update({ [vColumn]: new Date().toISOString() })
              .eq("id", signupId)
              .is(vColumn, null)
              .select("id");
            if (claimError) throw claimError;
            if (!claimed?.length) {
              volunteerTotals[kind].skipped++;
              continue;
            }

            const ctx: VolunteerShiftEmailContext = {
              opportunityId: opportunity.id as number,
              role: opportunity.role as string,
              description: opportunity.description as string | null,
              whatToBring: opportunity.what_to_bring as string | null,
              shiftStart: opportunity.shift_start as string,
              shiftEnd: opportunity.shift_end as string,
              eventId: event.id,
              eventName: event.name,
              timezone: event.timezone,
              location: event.location,
              virtualLink: event.virtual_link,
              virtualAccessNotes: event.virtual_access_notes,
              leadName: event.lead_name,
              leadPhone: event.lead_phone,
              leadEmail: event.lead_email,
            };

            try {
              await sendVolunteerReminderEmail({ ctx, toEmail: email, kind });
            } catch (sendErr) {
              await supabase.from("volunteer_signups").update({ [vColumn]: null }).eq("id", signupId);
              throw sendErr;
            }
            volunteerTotals[kind].sent++;
            console.log(`[reminders] volunteer event ${event.id} (${kind}): sent to ${email}`);
          } catch (err) {
            volunteerTotals[kind].failed++;
            console.error(
              `[reminders] volunteer event ${event.id} (${kind}) signup ${signupId} failed:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      }
    }
  }

  console.log("[reminders] done", { now: now.toISOString(), dry, totals, volunteerTotals });

  // A handful of emails, so before the opportunities email, which can run
  // up to the time limit.
  let membersOutreach: MembersEmailRunSummary | { error: string };
  try {
    membersOutreach = await runMembersOutreachEmail(supabase, { now, dry });
    for (const failure of membersOutreach.failed) console.error("[members-outreach-email]", failure);
    console.log("[members-outreach-email] done", membersOutreach);
  } catch (err) {
    console.error("[members-outreach-email] failed:", err);
    membersOutreach = { error: err instanceof Error ? err.message : String(err) };
  }

  let opportunities: OpportunitiesRunSummary | { error: string };
  try {
    opportunities = await runOpportunitiesEmail(supabase, {
      now,
      dry,
      deadline: startedAt + maxDuration * 1000 - OPPORTUNITIES_MARGIN_MS,
    });
    for (const failure of opportunities.failed) console.error("[opportunities-email]", failure);
    console.log("[opportunities-email] done", {
      today: opportunities.today,
      ran: opportunities.ran,
      why: opportunities.why,
      opportunities: opportunities.opportunities.length,
      nudges: opportunities.nudges.length,
      cycle: opportunities.cycle,
      alreadyHandled: opportunities.alreadyHandled,
      leftForNextRun: opportunities.leftForNextRun,
      failed: opportunities.failed.length,
      nothing: opportunities.nothing.length,
    });
  } catch (err) {
    console.error("[opportunities-email] failed:", err);
    opportunities = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    dry,
    walkupWelcome,
    totals,
    volunteerTotals,
    membersOutreach,
    opportunities,
  });
}
