import type { SupabaseClient } from "@supabase/supabase-js";

import type { createAdminClient } from "@/lib/supabase/admin";
import { activeChapters, currentHomeChapterName, loadChapters } from "@/lib/chapters";
import { formatPhoneNumber } from "@/lib/phone";
import { getSiteUrl } from "@/lib/site-url";
import { bulkSendGapMs, sendAdminMemberOutreachEmail, sendMemberOutreachEmail } from "@/lib/email/send";
import type { AdminOutreachChapter, OutreachEmailSection } from "@/lib/email/templates";
import {
  attendanceSummary,
  describeMember,
  lastOutreachText,
  memberSettingsFrom,
  outreachSections,
  type Member,
  type MemberStats,
} from "@/lib/members";
import { dateInZone, SCHEDULE_ZONE } from "@/lib/opportunities-schedule";

/**
 * The weekly "who to reach out to" email (Part 2 of Members; 2026-10-09
 * "Members: the weekly outreach email" entry in schema-changes.sql). Runs
 * inside the daily reminders cron.
 *
 *  - Each active chapter's member engagement lead (anyone approved, as an
 *    approved volunteer, for the role type chosen in Setup → Members, whose
 *    home chapter it is) gets their chapter's "Needs outreach" sections,
 *    built the same way as the Members page (lib/members.ts).
 *  - The admins (ADMIN_NOTIFICATION_EMAILS) get one combined summary, with
 *    the full list for any chapter nobody was sent it for.
 *  - Nothing goes to a chapter with nobody to reach out to, and the admin
 *    summary is skipped when nobody anywhere needs outreach.
 *
 * It goes out on the chosen weekday, or on the CATCH_UP_DAYS after it if a
 * run was missed or a send failed. member_outreach_emails has a row per
 * recipient per week: a sent one is never sent again that week, and a
 * failed one is retried up to MAX_ATTEMPTS times.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Runs on the send day and up to this many days after, for catch-up. */
const CATCH_UP_DAYS = 2;
const MAX_ATTEMPTS = 3;
/** member_outreach_emails.recipient for the admins' combined email. */
const ADMINS = "admins";

export type MembersEmailSettings = {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  roleTypeId: number | null;
};

export async function loadMembersEmailSettings(client: SupabaseClient): Promise<MembersEmailSettings> {
  const { data, error } = await client
    .from("app_settings")
    .select("members_email_enabled, members_email_weekday, members_email_role_type_id")
    .maybeSingle();
  if (error) throw new Error(`loading the outreach email settings: ${error.message}`);
  return {
    enabled: data?.members_email_enabled === true,
    weekday: (data?.members_email_weekday as number | undefined) ?? 1,
    roleTypeId: (data?.members_email_role_type_id as number | null | undefined) ?? null,
  };
}

/** The most recent `weekday` on or before `today` (YYYY-MM-DD). */
export function weekOf(today: string, weekday: number): string {
  const day = new Date(`${today}T00:00:00Z`);
  const back = (day.getUTCDay() - weekday + 7) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

export type EngagementLead = { userId: string; email: string; firstName: string; name: string; chapter: string };

/** Who holds the role, by home chapter: approved volunteers with an active
 * approval for it, access not removed, with an email. */
export async function loadEngagementLeads(
  client: SupabaseClient,
  roleTypeId: number | null,
): Promise<{ roleName: string | null; byChapter: Map<string, EngagementLead[]> }> {
  const byChapter = new Map<string, EngagementLead[]>();
  if (roleTypeId == null) return { roleName: null, byChapter };

  const [{ data: roleType }, { data: approvals, error }] = await Promise.all([
    client.from("volunteer_role_types").select("name").eq("id", roleTypeId).maybeSingle(),
    client.from("volunteer_role_approvals").select("volunteer_id").eq("role_type_id", roleTypeId).is("revoked_at", null),
  ]);
  if (error) throw new Error(`loading role approvals: ${error.message}`);
  const ids = [...new Set((approvals ?? []).map((a) => a.volunteer_id as string))];
  if (ids.length === 0) return { roleName: (roleType?.name as string | undefined) ?? null, byChapter };

  const [{ data: volunteers }, { data: profiles }] = await Promise.all([
    client.from("volunteers").select("user_id").in("user_id", ids).eq("status", "approved"),
    client
      .from("profiles")
      .select("id, email, first_name, last_name, chapter")
      .in("id", ids)
      .is("access_removed_at", null),
  ]);
  const approved = new Set((volunteers ?? []).map((v) => v.user_id as string));
  for (const p of profiles ?? []) {
    const email = ((p.email as string | null) ?? "").trim();
    const chapter = currentHomeChapterName(p.chapter as string | null);
    if (!approved.has(p.id as string) || !email || !chapter) continue;
    const firstName = ((p.first_name as string | null) ?? "").trim();
    const name = [firstName, ((p.last_name as string | null) ?? "").trim()].filter(Boolean).join(" ") || email;
    byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), { userId: p.id as string, email, firstName, name, chapter }]);
  }
  return { roleName: (roleType?.name as string | undefined) ?? null, byChapter };
}

/** A chapter's "Needs outreach" as email sections. */
function emailSections(members: Member[], chapter: string | null, today: string): OutreachEmailSection[] {
  const site = getSiteUrl();
  const page = `${site}/protected/members?chapter=${encodeURIComponent(chapter ?? "all")}`;
  return outreachSections(members).map((section) => ({
    title: section.title,
    hint: section.hint,
    people: section.rows.map((m) => ({
      name: m.name,
      url: `${page}#member-${m.user_id}`,
      lines: [
        [formatPhoneNumber(m.phone ?? ""), m.email].filter(Boolean).join(" · "),
        `${attendanceSummary(m, today)}${m.dropAlertSince ? " · used to come regularly" : ""}`,
        lastOutreachText(m, today),
      ].filter(Boolean),
    })),
  }));
}

const countOf = (sections: OutreachEmailSection[]) => sections.reduce((n, s) => n + s.people.length, 0);

export type MembersEmailRunSummary = {
  today: string;
  ran: boolean;
  why: string;
  weekOf?: string;
  sent: string[];
  skipped: string[];
  failed: string[];
};

/** The daily-cron entry point. `dry` works out who'd get what and sends
 * and records nothing. */
export async function runMembersOutreachEmail(
  admin: AdminClient,
  { now, dry = false }: { now: Date; dry?: boolean },
): Promise<MembersEmailRunSummary> {
  const today = dateInZone(now, SCHEDULE_ZONE);
  const summary: MembersEmailRunSummary = { today, ran: false, why: "", sent: [], skipped: [], failed: [] };
  const settings = await loadMembersEmailSettings(admin);
  if (!settings.enabled) return { ...summary, why: "turned off in Setup" };
  const week = weekOf(today, settings.weekday);
  const daysIn = Math.round((Date.parse(today) - Date.parse(week)) / 86_400_000);
  if (daysIn > CATCH_UP_DAYS) return { ...summary, weekOf: week, why: "not a send day" };

  const { data: done, error: doneError } = await admin
    .from("member_outreach_emails")
    .select("recipient, sent_at, attempts")
    .eq("week_of", week);
  if (doneError) throw new Error(`member_outreach_emails: ${doneError.message}`);
  const handled = new Set(
    (done ?? []).filter((r) => r.sent_at || (r.attempts as number) >= MAX_ATTEMPTS).map((r) => r.recipient as string),
  );
  const attemptsSoFar = new Map((done ?? []).map((r) => [r.recipient as string, r.attempts as number]));

  // Everyone, once, grouped by home chapter (as stored, which Members matches).
  const [{ data: rows, error }, { data: settingsRow }, chapters, leads] = await Promise.all([
    admin.rpc("members_list", { p_chapter: null, p_all: true }),
    admin.from("app_settings").select("*").maybeSingle(),
    loadChapters(admin),
    loadEngagementLeads(admin, settings.roleTypeId),
  ]);
  if (error) throw new Error(`members_list: ${error.message}`);
  const memberSettings = memberSettingsFrom(settingsRow as Record<string, unknown> | null);
  const byChapter = new Map<string, Member[]>();
  for (const row of (rows ?? []) as MemberStats[]) {
    const m = describeMember(row, memberSettings, today);
    if (!m.needsOutreach) continue;
    const key = m.chapter?.trim() ?? "";
    byChapter.set(key, [...(byChapter.get(key) ?? []), m]);
  }

  const record = async (recipient: string, chapter: string | null, err: unknown) => {
    if (dry) return;
    await admin.from("member_outreach_emails").upsert({
      week_of: week,
      recipient,
      chapter,
      ...(err == null
        ? { sent_at: new Date().toISOString(), last_error: null }
        : { attempts: (attemptsSoFar.get(recipient) ?? 0) + 1, last_error: err instanceof Error ? err.message : String(err) }),
    });
  };

  const gap = bulkSendGapMs();
  let first = true;
  const pause = async () => {
    if (!first && !dry) await new Promise((resolve) => setTimeout(resolve, gap));
    first = false;
  };

  const chapterNames = activeChapters(chapters).map((c) => c.name);
  const adminChapters: AdminOutreachChapter[] = [];
  for (const chapter of chapterNames) {
    const sections = emailSections(byChapter.get(chapter) ?? [], chapter, today);
    const chapterLeads = leads.byChapter.get(chapter) ?? [];
    adminChapters.push({
      chapter,
      total: countOf(sections),
      sentTo: chapterLeads.map((l) => l.name),
      sections: chapterLeads.length === 0 ? sections : [],
    });
    if (sections.length === 0 || !leads.roleName) continue;
    for (const lead of chapterLeads) {
      const label = `${lead.name} (${chapter})`;
      if (handled.has(lead.userId)) {
        summary.skipped.push(`${label}: already handled this week`);
        continue;
      }
      if (dry) {
        summary.sent.push(`${label}: would send ${countOf(sections)}`);
        continue;
      }
      await pause();
      try {
        await sendMemberOutreachEmail({
          toEmail: lead.email,
          firstName: lead.firstName || null,
          chapter,
          roleName: leads.roleName,
          sections,
          membersUrl: `${getSiteUrl()}/protected/members?chapter=${encodeURIComponent(chapter)}`,
        });
        await record(lead.userId, chapter, null);
        summary.sent.push(label);
      } catch (err) {
        await record(lead.userId, chapter, err);
        summary.failed.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // The admins' summary: skipped when nobody anywhere needs outreach. No
  // chapter, "No local chapter" and a retired chapter all count as none.
  const noChapterCount = [...byChapter.entries()]
    .filter(([key]) => !chapterNames.includes(key))
    .reduce((n, [, members]) => n + members.length, 0);
  const anyone = adminChapters.some((c) => c.total > 0) || noChapterCount > 0;
  if (!anyone) summary.skipped.push("admins: nobody needs outreach");
  else if (handled.has(ADMINS)) summary.skipped.push("admins: already handled this week");
  else if (dry) summary.sent.push("admins: would send the summary");
  else {
    await pause();
    try {
      const sent = await sendAdminMemberOutreachEmail({
        roleName: leads.roleName,
        chapters: adminChapters,
        noChapterCount,
        membersUrl: `${getSiteUrl()}/protected/members?chapter=all`,
        setupUrl: `${getSiteUrl()}/protected/admin/setup/members`,
      });
      if (sent) {
        await record(ADMINS, null, null);
        summary.sent.push("admins");
      } else summary.skipped.push("admins: ADMIN_NOTIFICATION_EMAILS not set");
    } catch (err) {
      await record(ADMINS, null, err);
      summary.failed.push(`admins: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ...summary, ran: true, weekOf: week, why: dry ? "dry run" : "send day" };
}
