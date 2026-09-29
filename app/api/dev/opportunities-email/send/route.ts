import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOpportunitiesEmail } from "@/lib/volunteer-opportunities-email";
import { resolveDevVolunteer } from "@/lib/dev-volunteer";

/**
 * Dev-only: send one volunteer their volunteer opportunities email now,
 * whatever the day — to check it without waiting for a send day.
 *
 *   /api/dev/opportunities-email/send?email=someone@example.com
 *   /api/dev/opportunities-email/send?user_id=<uuid>&today=2026-10-20
 *   /api/dev/opportunities-email/send?email=someone@example.com&to=me@example.com
 *
 * Same rules as the real run about who gets what — nothing is sent when
 * they'd get nothing (the reason comes back), and the opt-out is respected.
 * It skips the schedule and the once-a-day record, so it never stops the
 * real run from sending them theirs. `to` sends it to that address instead
 * of theirs (their unsubscribe link still turns off THEIR email). `today`
 * moves the six-week window. Creates their unsubscribe token if they have
 * none.
 *
 * Only under `next dev` (404 otherwise), only for a signed-in admin, and
 * only ever for the one volunteer named — dev runs against the live
 * database and sends real email.
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
  const to = searchParams.get("to")?.trim() ?? "";
  if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: "to must be an email address" }, { status: 400 });
  }

  const admin = createAdminClient();
  const volunteer = await resolveDevVolunteer(admin, searchParams);
  if ("error" in volunteer) return NextResponse.json({ error: volunteer.error }, { status: 400 });

  try {
    const summary = await runOpportunitiesEmail(admin, {
      now: today ? new Date(`${today}T15:00:00Z`) : new Date(),
      userId: volunteer.userId,
      ignoreSchedule: true,
      redirectTo: to || undefined,
    });
    return NextResponse.json({ volunteer: volunteer.userId, sentTo: to || null, ...summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
