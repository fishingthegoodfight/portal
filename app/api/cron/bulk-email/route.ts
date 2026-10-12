import { after, NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { processBulkEmailQueue } from "@/lib/bulk-email";

// Sends spaced a second apart (Gmail), so give it room; it stops itself
// well before this and leaves the rest for the next run.
export const maxDuration = 300;

/**
 * Every 5 minutes (a Supabase pg_cron job, like the hourly waitlist one —
 * see the 2026-10-12 "Email from Members and event rosters" entry in
 * schema-changes.sql): sends whatever Members and roster emails are still
 * queued (lib/bulk-email.ts). Usually nothing: a send starts going out the
 * moment it's queued, and this only finishes a big one.
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The pg_cron caller gives up waiting after 30 seconds, so answer at once
  // and send afterwards, for up to maxDuration.
  after(async () => {
    try {
      const summary = await processBulkEmailQueue(startedAt + (maxDuration - 30) * 1000);
      if (summary.sent || summary.failed) console.log("[bulk-email] cron run", summary);
    } catch (err) {
      console.error("[bulk-email] cron run failed:", err);
    }
  });
  return NextResponse.json({ ok: true, started: true });
}
