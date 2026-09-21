import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLapsedOffers, emailWaitlistOffers, type OfferedSpot } from "@/lib/waitlist";

/**
 * Hourly waitlist upkeep, called by pg_cron/pg_net (see the 2026-09-21 entry
 * in schema-changes.sql) with `Authorization: Bearer $CRON_SECRET`:
 *   1. offers that passed offer_expires_at become status 'expired'
 *   2. each freed spot is offered to the next waitlisted person
 *   3. emails go out: "your offer lapsed" and "a spot opened"
 * Steps 1–2 happen inside one database function (process_waitlist_expiry) that
 * locks each event, so overlapping or repeated runs are safe: a second run
 * finds nothing lapsed and nothing free, changes nothing, and sends nothing.
 *
 * Dev only (`next dev`; the secret is skipped there too): ?now=<ISO time>
 * pretends it's that moment, e.g.
 *   /api/cron/waitlist?now=2026-09-23T18:00:00Z
 * Offers made by a real cancellation expire 24h after the real time, so use a
 * `now` more than 24h ahead to see them lapse and roll to the next person.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isDev = process.env.NODE_ENV === "development";
  const nowParam = isDev ? new URL(request.url).searchParams.get("now") : null;
  let now = new Date();
  if (nowParam) {
    now = new Date(nowParam);
    if (Number.isNaN(now.getTime())) {
      return NextResponse.json({ error: "now must be an ISO timestamp" }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "process_waitlist_expiry",
    nowParam ? { p_now: now.toISOString() } : {},
  );
  if (error) {
    console.error("[waitlist-cron] process_waitlist_expiry failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as {
    expired: { event_id: number; user_id: string }[];
    offered: (OfferedSpot & { event_id: number })[];
  };

  const lapsedByEvent = new Map<number, string[]>();
  for (const e of result.expired) {
    lapsedByEvent.set(e.event_id, [...(lapsedByEvent.get(e.event_id) ?? []), e.user_id]);
  }
  const offeredByEvent = new Map<number, OfferedSpot[]>();
  for (const o of result.offered) {
    offeredByEvent.set(o.event_id, [...(offeredByEvent.get(o.event_id) ?? []), o]);
  }

  let lapseEmails = 0;
  let offerEmails = 0;
  for (const [eventId, userIds] of lapsedByEvent) {
    lapseEmails += await emailLapsedOffers(eventId, userIds, now);
  }
  for (const [eventId, offers] of offeredByEvent) {
    offerEmails += await emailWaitlistOffers(eventId, offers);
  }

  const summary = {
    now: now.toISOString(),
    expired: result.expired.length,
    offered: result.offered.length,
    lapseEmailsSent: lapseEmails,
    offerEmailsSent: offerEmails,
  };
  console.log("[waitlist-cron] done", summary);
  return NextResponse.json({ ok: true, ...summary });
}
