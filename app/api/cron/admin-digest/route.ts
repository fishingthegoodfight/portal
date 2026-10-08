import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DIGEST_NOTES, DIGEST_SOURCES } from "@/lib/admin-digest";
import { sendAdminDigestEmail } from "@/lib/email/send";
import type { AdminDigestSection } from "@/lib/email/templates";
import { getSiteUrl } from "@/lib/site-url";
import { runReferenceReminders, type ReferenceReminderSummary } from "@/lib/reference-reminders";

/**
 * The daily admin digest (Vercel Cron, see vercel.json — daily is Vercel
 * Hobby's limit). First runs the weekly reference reminders
 * (lib/reference-reminders.ts), so a reference that gives up today is in
 * today's digest. A failure there doesn't stop the digest: it goes at the
 * top of it ("Reference reminders failed"), and is enough on its own to
 * send one, so a broken job can't hide behind a clean digest. A clean run
 * logs what it checked, so a quiet day can be told from one that never ran.
 * Then builds every section (lib/admin-digest.ts), sends one email if any
 * has items, and only then marks those items as sent — so a failed send
 * lists them again tomorrow instead of losing them. The "For information"
 * notes (DIGEST_NOTES) go at the end of that email, and never cause one.
 */
/** The reference reminder job's failures as a digest section: the whole
 * run failing, or single reminders that did. Empty (so left out of the
 * email) when there were none. */
function referenceFailureSection(references: ReferenceReminderSummary | { error: string }): AdminDigestSection {
  const url = `${getSiteUrl()}/protected/admin/applications`;
  const items =
    "error" in references
      ? [{ label: "The reminder job didn't run", detail: references.error, url }]
      : references.failed.map((failure) => ({ label: "A reminder wasn't sent", detail: failure, url }));
  return {
    title: `Reference reminders failed (${items.length})`,
    intro:
      "Automatic reminders to volunteer references failed today. Nothing else in this digest is affected. A failed reminder is tried again tomorrow.",
    items,
  };
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let references: ReferenceReminderSummary | { error: string };
  try {
    references = await runReferenceReminders(admin, { now: new Date() });
    for (const failure of references.failed) console.error("[reference-reminders]", failure);
    console.log("[reference-reminders] done", {
      checked: references.checked,
      reminded: references.reminded.length,
      gaveUp: references.gaveUp.length,
      failed: references.failed.length,
    });
  } catch (err) {
    console.error("[reference-reminders] failed:", err);
    references = { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const built = await Promise.all(DIGEST_SOURCES.map((source) => source(admin)));
    const notes = (await Promise.all(DIGEST_NOTES.map((note) => note(admin)))).filter((note) => note != null);
    const sent = await sendAdminDigestEmail(
      [referenceFailureSection(references), ...built.map((b) => b.section)],
      notes,
    );
    if (sent) {
      for (const b of built) await b.markSent();
    }
    return NextResponse.json({
      references,
      sent,
      items: Object.fromEntries(built.map((b) => [b.section.title, b.section.items.length])),
      notes,
    });
  } catch (err) {
    console.error("[admin-digest] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
