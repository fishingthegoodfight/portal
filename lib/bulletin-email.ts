import { isVirtualChapter } from "@/lib/chapters";
import { loadBulletin, needsLabel } from "@/lib/bulletin";
import { sendAdminBulletinEmail } from "@/lib/email/send";
import { dateInZone } from "@/lib/format-date";
import { SCHEDULE_ZONE } from "@/lib/opportunities-schedule";
import { getSiteUrl } from "@/lib/site-url";

/** Monday, in getUTCDay terms. */
const SEND_WEEKDAY = 1;

/**
 * The Monday bulletin email to the admins (adminBulletinEmail), run by the
 * daily admin-digest cron — 14:00 UTC, so early Monday morning in Denver.
 * Any other day it does nothing. No catch-up and no record of sends: a
 * missed Monday only means no email that week, and the bulletin page itself
 * is always there. `force` sends whatever the day (the dev-only
 * ?bulletin=1 on the cron route).
 */
export async function runBulletinEmail(now: Date, { force = false } = {}): Promise<{ sent: boolean; why: string }> {
  const today = dateInZone(now, SCHEDULE_ZONE);
  if (!force && new Date(`${today}T00:00:00Z`).getUTCDay() !== SEND_WEEKDAY) {
    return { sent: false, why: "not Monday" };
  }
  const bulletin = await loadBulletin(now);
  const site = getSiteUrl();
  const sent = await sendAdminBulletinEmail({
    rangeLabel: bulletin.rangeLabel,
    bulletinUrl: `${site}/bulletin`,
    regionLinks: bulletin.regionNames.map((name) => ({
      name,
      url: `${site}/bulletin?region=${encodeURIComponent(name)}`,
    })),
    eventCount: bulletin.eventCount,
    openVolunteerSlots: bulletin.openVolunteerSlots,
    needs: bulletin.regions
      .flatMap((r) => r.events)
      .filter((e) => e.needs.length > 0)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((e) => ({
        name: e.name,
        when: `${e.day} · ${e.time}`,
        chapter: isVirtualChapter(e.chapter) ? "Virtual" : e.chapter,
        roles: needsLabel(e.needs),
        url: `${site}${e.path}`,
      })),
    retreats: bulletin.retreats.map((r) => ({
      name: r.name,
      dates: r.dates,
      enrolled: r.enrolled,
      capacity: r.capacity,
    })),
  });
  return { sent, why: sent ? "sent" : "ADMIN_NOTIFICATION_EMAILS not set" };
}
