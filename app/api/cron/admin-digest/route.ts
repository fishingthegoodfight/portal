import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DIGEST_SOURCES } from "@/lib/admin-digest";
import { sendAdminDigestEmail } from "@/lib/email/send";

/**
 * The daily admin digest (Vercel Cron, see vercel.json — daily is Vercel
 * Hobby's limit). Builds every section (lib/admin-digest.ts), sends one
 * email if any has items, and only then marks those items as sent — so a
 * failed send lists them again tomorrow instead of losing them.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  try {
    const built = await Promise.all(DIGEST_SOURCES.map((source) => source(admin)));
    const sent = await sendAdminDigestEmail(built.map((b) => b.section));
    if (sent) {
      for (const b of built) await b.markSent();
    }
    return NextResponse.json({
      sent,
      items: Object.fromEntries(built.map((b) => [b.section.title, b.section.items.length])),
    });
  } catch (err) {
    console.error("[admin-digest] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
