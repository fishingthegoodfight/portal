import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DIGEST_SOURCES } from "@/lib/admin-digest";
import { sendAdminDigestEmail } from "@/lib/email/send";
import { runReferenceReminders, type ReferenceReminderSummary } from "@/lib/reference-reminders";

/**
 * The daily admin digest (Vercel Cron, see vercel.json — daily is Vercel
 * Hobby's limit). First runs the weekly reference reminders
 * (lib/reference-reminders.ts), so a reference that gives up today is in
 * today's digest; a failure there is logged and doesn't stop the digest.
 * Then builds every section (lib/admin-digest.ts), sends one email if any
 * has items, and only then marks those items as sent — so a failed send
 * lists them again tomorrow instead of losing them.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let references: ReferenceReminderSummary | { error: string };
  try {
    references = await runReferenceReminders(admin, { now: new Date() });
    for (const failure of references.failed) console.error("[reference-reminders]", failure);
  } catch (err) {
    console.error("[reference-reminders] failed:", err);
    references = { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const built = await Promise.all(DIGEST_SOURCES.map((source) => source(admin)));
    const sent = await sendAdminDigestEmail(built.map((b) => b.section));
    if (sent) {
      for (const b of built) await b.markSent();
    }
    return NextResponse.json({
      references,
      sent,
      items: Object.fromEntries(built.map((b) => [b.section.title, b.section.items.length])),
    });
  } catch (err) {
    console.error("[admin-digest] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
