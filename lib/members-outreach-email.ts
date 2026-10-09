import type { SupabaseClient } from "@supabase/supabase-js";

import type { createAdminClient } from "@/lib/supabase/admin";
import { activeChapters, loadChapters } from "@/lib/chapters";
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
 *  - Each active chapter's chosen recipient (chapters.outreach_email_to,
 *    picked in Setup → Members from the people who can open that chapter on
 *    Members) gets its "Needs outreach" sections, built the same way as the
 *    Members page (lib/members.ts).
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
};

export async function loadMembersEmailSettings(client: SupabaseClient): Promise<MembersEmailSettings> {
  const { data, error } = await client
    .from("app_settings")
    .select("members_email_enabled, members_email_weekday")
    .maybeSingle();
  if (error) throw new Error(`loading the outreach email settings: ${error.message}`);
  return {
    enabled: data?.members_email_enabled === true,
    weekday: (data?.members_email_weekday as number | undefined) ?? 1,
  };
}

/** The most recent `weekday` on or before `today` (YYYY-MM-DD). */
export function weekOf(today: string, weekday: number): string {
  const day = new Date(`${today}T00:00:00Z`);
  const back = (day.getUTCDay() - weekday + 7) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

export type OutreachCandidate = { userId: string; email: string; firstName: string; name: string };

const personOf = (p: Record<string, unknown>): OutreachCandidate | null => {
  const email = ((p.email as string | null) ?? "").trim();
  if (!email) return null;
  const firstName = ((p.first_name as string | null) ?? "").trim();
  const name = [firstName, ((p.last_name as string | null) ?? "").trim()].filter(Boolean).join(" ") || email;
  return { userId: p.id as string, email, firstName, name };
};

/**
 * Who can be picked for each chapter: the people who can open it on
 * Members (my_member_chapters): its chapter leads, and anyone approved for
 * a "Chapter leadership team" role type whose home chapter it is. Access
 * not removed, with an email. Sorted by name.
 */
export async function loadOutreachCandidates(client: SupabaseClient): Promise<Map<string, OutreachCandidate[]>> {
  const byChapter = new Map<string, OutreachCandidate[]>();
  const add = (chapter: string, person: OutreachCandidate) => {
    const list = byChapter.get(chapter) ?? [];
    if (!list.some((c) => c.userId === person.userId)) byChapter.set(chapter, [...list, person]);
  };

  const [{ data: leads, error }, { data: teamTypes }] = await Promise.all([
    client
      .from("profiles")
      .select("id, email, first_name, last_name, led_chapters")
      .eq("role", "chapter_lead")
      .is("access_removed_at", null),
    client.from("volunteer_role_types").select("id").eq("leadership_team", true),
  ]);
  if (error) throw new Error(`loading chapter leads: ${error.message}`);
  for (const p of leads ?? []) {
    const person = personOf(p);
    if (person) for (const chapter of (p.led_chapters as string[] | null) ?? []) add(chapter, person);
  }

  const typeIds = (teamTypes ?? []).map((t) => t.id as number);
  if (typeIds.length > 0) {
    const { data: approvals } = await client
      .from("volunteer_role_approvals")
      .select("volunteer_id")
      .in("role_type_id", typeIds)
      .is("revoked_at", null);
    const ids = [...new Set((approvals ?? []).map((a) => a.volunteer_id as string))];
    if (ids.length > 0) {
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
        const person = personOf(p);
        const chapter = ((p.chapter as string | null) ?? "").trim();
        if (person && chapter && approved.has(p.id as string)) add(chapter, person);
      }
    }
  }
  for (const list of byChapter.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return byChapter;
}

/** Each chapter's chosen recipient (chapters.outreach_email_to), by name. */
export async function loadOutreachRecipientIds(client: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await client.from("chapters").select("name, outreach_email_to");
  if (error) throw new Error(`loading outreach recipients: ${error.message}`);
  return new Map(
    (data ?? []).filter((c) => c.outreach_email_to).map((c) => [c.name as string, c.outreach_email_to as string]),
  );
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
  const [{ data: rows, error }, { data: settingsRow }, chapters, candidates, recipientIds] = await Promise.all([
    admin.rpc("members_list", { p_chapter: null, p_all: true }),
    admin.from("app_settings").select("*").maybeSingle(),
    loadChapters(admin),
    loadOutreachCandidates(admin),
    loadOutreachRecipientIds(admin),
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
    // Only while they can still open the chapter on Members: someone
    // picked, then no longer a lead there, isn't sent it.
    const chosenId = recipientIds.get(chapter);
    const lead = (candidates.get(chapter) ?? []).find((c) => c.userId === chosenId) ?? null;
    adminChapters.push({
      chapter,
      total: countOf(sections),
      sentTo: lead?.name ?? null,
      problem: chosenId && !lead ? "the person picked can no longer open this chapter on Members" : null,
      sections: lead ? [] : sections,
    });
    if (sections.length === 0 || !lead) continue;
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
