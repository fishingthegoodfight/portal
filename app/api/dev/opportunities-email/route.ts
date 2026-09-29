import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchedule, planOpportunitiesEmails, previewPlannedEmail } from "@/lib/volunteer-opportunities-email";
import { dateInZone, isSendDate, nextSendDates, SCHEDULE_ZONE } from "@/lib/opportunities-schedule";
import { resolveDevVolunteer } from "@/lib/dev-volunteer";

/**
 * Dev-only: what one volunteer would get in the volunteer opportunities
 * email, without sending or saving anything.
 *
 *   /api/dev/opportunities-email?email=someone@example.com
 *   /api/dev/opportunities-email?user_id=<uuid>&today=2026-10-20
 *   /api/dev/opportunities-email?email=someone@example.com&format=json
 *
 * Shows the email as it would render (or why they'd get nothing), plus
 * whether `today` (default: now, Denver date) is a send day. `today` moves
 * the six-week window too. The unsubscribe links in a preview are
 * placeholders.
 *
 * Only under `next dev` (404 otherwise — a production build has NODE_ENV
 * "production", on Vercel and anywhere else), and only for a signed-in
 * admin. See ./send for sending it to one person.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const adminCheck = await requireAdmin(await createClient());
  if ("error" in adminCheck) return NextResponse.json({ error: adminCheck.error }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const today = searchParams.get("today");
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return NextResponse.json({ error: "today must be YYYY-MM-DD" }, { status: 400 });
  }
  // 15:00 UTC — when the reminders cron runs — so `today` is the Denver date.
  const now = today ? new Date(`${today}T15:00:00Z`) : new Date();

  const admin = createAdminClient();
  const volunteer = await resolveDevVolunteer(admin, searchParams);
  if ("error" in volunteer) return NextResponse.json({ error: volunteer.error }, { status: 400 });

  try {
    const [schedule, [recipient]] = await Promise.all([
      loadSchedule(admin),
      planOpportunitiesEmails(admin, { now, userId: volunteer.userId }),
    ]);
    const asOf = dateInZone(now, SCHEDULE_ZONE);
    const scheduleInfo = {
      enabled: schedule.enabled,
      asOf,
      isSendDay: isSendDate(schedule, asOf),
      nextSendDays: nextSendDates(schedule, asOf, 3),
    };
    if (!recipient) {
      return NextResponse.json({ schedule: scheduleInfo, plan: { kind: "none", reason: "not a volunteer" } });
    }
    const rendered = previewPlannedEmail(recipient);

    if (searchParams.get("format") === "json") {
      return NextResponse.json({
        schedule: scheduleInfo,
        to: recipient.email,
        homeChapter: recipient.homeChapter,
        coverage: recipient.coverage,
        handledCycle: recipient.handledCycle,
        plan: recipient.plan,
        subject: rendered?.subject ?? null,
        text: rendered?.text ?? null,
      });
    }

    const escape = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const facts = [
      ["To", recipient.email || "(no email)"],
      ["Home chapter", recipient.homeChapter || "(none)"],
      ["Covers", recipient.coverage || "—"],
      [
        "Would get",
        recipient.plan.kind === "none"
          ? `nothing — ${recipient.plan.reason}`
          : recipient.plan.kind === "nudge"
            ? "the finish-registration nudge"
            : `opportunities: ${recipient.plan.roleCount} roles at ${recipient.plan.events.length} events`,
      ],
      ["Subject", rendered?.subject ?? "—"],
      [
        "Schedule",
        `${schedule.enabled ? "on" : "OFF"} · ${asOf} ${scheduleInfo.isSendDay ? "is" : "isn't"} a send day · next: ${scheduleInfo.nextSendDays.join(", ")}`,
      ],
      ["Last handled cycle", recipient.handledCycle ?? "never"],
    ];
    const page = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Opportunities email preview</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#e7e5e4;">
<div style="max-width:640px;margin:0 auto;padding:16px;">
<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;font-size:14px;">
${facts.map(([k, v]) => `<tr><td style="padding:6px 10px;color:#57534e;white-space:nowrap;vertical-align:top;">${escape(k)}</td><td style="padding:6px 10px;">${escape(v)}</td></tr>`).join("")}
</table>
${rendered ? `<iframe title="Email" style="width:100%;height:1200px;border:0;margin-top:16px;" srcdoc="${escape(rendered.html)}"></iframe>` : ""}
</div></body></html>`;
    return new NextResponse(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
