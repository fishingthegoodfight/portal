import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { runReferenceReminders } from "@/lib/reference-reminders";

/**
 * Dev-only: run the reference reminder job as though it were another day,
 * for one application, to walk the whole sequence without waiting weeks.
 *
 *   /api/dev/reference-reminders?application_id=12&today=2026-10-05
 *   /api/dev/reference-reminders?application_id=12&today=2026-10-26&dry=1
 *
 * Reminders fall on days 7, 14 and 21 after each reference's request went
 * out, and the "needs a replacement" flag on day 28 (Denver dates). Step
 * `today` through those. Each run does at most one step per reference.
 *
 * Only under `next dev` (404 otherwise — a production build has NODE_ENV
 * "production", on Vercel and anywhere else), only for a signed-in admin,
 * and only ever for the one application named: dev runs against the live
 * database and sends real email, so it never touches anyone else's
 * references. ?dry=1 reports what would happen without sending or saving.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const adminCheck = await requireAdmin(await createClient());
  if ("error" in adminCheck) return NextResponse.json({ error: adminCheck.error }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const applicationId = Number(searchParams.get("application_id"));
  const today = searchParams.get("today") ?? "";
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    return NextResponse.json({ error: "Missing or invalid ?application_id=<id>" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return NextResponse.json({ error: "Missing or invalid ?today=YYYY-MM-DD" }, { status: 400 });
  }

  // 15:00 UTC is mid-morning in Denver, so `today` is the Denver date too.
  const now = new Date(`${today}T15:00:00Z`);
  try {
    const summary = await runReferenceReminders(createAdminClient(), {
      now,
      applicationId,
      dry: searchParams.get("dry") === "1",
    });
    return NextResponse.json({ asOf: today, applicationId, ...summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
