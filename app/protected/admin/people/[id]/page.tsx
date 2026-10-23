import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { eventChapterNames, homeChapterOption, loadChapters, timezoneForChapter } from "@/lib/chapters";
import { formatCertDate } from "@/lib/certifications";
import { formatDateInZone, todayInZone } from "@/lib/format-date";
import { formatPhoneNumber } from "@/lib/phone";
import {
  attendanceSummary,
  describeMember,
  memberSettingsFrom,
  type Member,
  type MemberStats,
} from "@/lib/members";
import {
  isSectionAnswered,
  profileValueFromColumn,
  REGISTRATION_SECTIONS,
} from "@/lib/registration-sections";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { ChapterTag } from "@/components/chapter-tag";
import { CollapsibleCard } from "@/components/collapsible-card";
import { LastOutreach, MemberBandBadge } from "@/components/members-view";
import { ContactDetailsForm, ProfileSectionForm } from "@/components/admin/person-details-forms";
import { PersonOutreach, type OutreachEntry } from "@/components/admin/person-outreach";
import { PersonRoles } from "@/components/admin/person-roles";
import { VolunteerSection } from "./volunteer-section";
import { Badge } from "@/components/ui/badge";

type EventRef = { id: number; name: string; starts_at: string; timezone: string; chapter: string | null; status: string | null };

type RsvpRow = {
  id: number;
  status: string;
  checked_in_at: string | null;
  imported_at: string | null;
  event: EventRef | null;
};

type SignupRow = {
  id: number;
  status: string;
  checked_in_at: string | null;
  imported_at: string | null;
  opportunity: { role: string; event: EventRef | null } | null;
};

/** One line of participation history: an RSVP or a volunteer shift. */
type HistoryRow = {
  key: string;
  event: EventRef;
  what: string;
  attended: boolean;
  imported: boolean;
};

const RSVP_OUTCOME: Record<string, string> = {
  waitlisted: "On the waitlist",
  offered: "Offered a spot",
  expired: "Waitlist offer expired",
  cancelled: "Cancelled RSVP",
};

function rsvpLine(r: RsvpRow, past: boolean): string {
  if (r.status === "confirmed") return r.checked_in_at ? "Attended" : past ? "RSVP'd, not checked in" : "RSVP'd";
  return RSVP_OUTCOME[r.status] ?? r.status;
}

function shiftLine(s: SignupRow, past: boolean): string {
  const role = s.opportunity?.role ?? "volunteer";
  if (s.status === "cancelled") return `Cancelled shift: ${role}`;
  if (s.checked_in_at) return `Volunteered: ${role}`;
  return past ? `Signed up to volunteer, not checked in: ${role}` : `Volunteering: ${role}`;
}

async function PersonLoader({ userId }: { userId: string }) {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) notFound();

  const [{ data: profile }, chapters, { data: settingsRow }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    loadChapters(supabase),
    supabase.from("app_settings").select("*").maybeSingle(),
  ]);
  if (!profile) notFound();

  const chapter = (profile.chapter as string | null)?.trim() || null;

  const [
    membersResult,
    { data: touches },
    { data: rsvps },
    { data: signups },
    { data: signatures },
    { data: healthYears },
  ] = await Promise.all([
    // The same numbers as Members: their chapter's list, or everyone's for
    // someone with no chapter, picked down to them.
    supabase.rpc("members_list", { p_chapter: chapter, p_all: chapter == null }),
    supabase
      .from("member_touches")
      .select("id, touched_on, touch_type, logged_by_name, note")
      .eq("member_id", userId)
      .order("touched_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("rsvps")
      .select("id, status, checked_in_at, imported_at, event:events(id, name, starts_at, timezone, chapter, status)")
      .eq("user_id", userId),
    supabase
      .from("volunteer_signups")
      .select(
        "id, status, checked_in_at, imported_at, opportunity:volunteer_opportunities(role, event:events(id, name, starts_at, timezone, chapter, status))",
      )
      .eq("user_id", userId),
    supabase
      .from("waiver_signatures")
      .select("signed_name, signed_at, waiver:waivers(audience, year, title)")
      .eq("user_id", userId)
      .order("signed_at", { ascending: false }),
    // The latest year they have a health form on file for, not its content.
    supabase.rpc("health_history_latest_years", { p_user_ids: [userId] }),
  ]);

  const today = todayInZone("America/Denver");
  const statsRow = ((membersResult.data ?? []) as MemberStats[]).find((m) => m.user_id === userId);
  const member: Member | null = statsRow
    ? describeMember(statsRow, memberSettingsFrom(settingsRow as Record<string, unknown> | null), today)
    : null;

  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email || "Unnamed";
  const email = (profile.email as string | null) ?? "";
  const phone = formatPhoneNumber((profile.phone as string | null) ?? "");
  const role = profile.role as Role;
  const timeZone = timezoneForChapter(chapter, chapters);

  // ---- Participation history, newest first ------------------------------------
  const now = new Date().toISOString();
  const history: HistoryRow[] = [
    ...((rsvps ?? []) as unknown as RsvpRow[])
      .filter((r) => r.event)
      .map((r) => ({
        key: `r${r.id}`,
        event: r.event as EventRef,
        what: rsvpLine(r, (r.event as EventRef).starts_at <= now),
        attended: r.status === "confirmed" && r.checked_in_at != null,
        imported: r.imported_at != null,
      })),
    ...((signups ?? []) as unknown as SignupRow[])
      .filter((s) => s.opportunity?.event)
      .map((s) => ({
        key: `s${s.id}`,
        event: s.opportunity!.event as EventRef,
        what: shiftLine(s, (s.opportunity!.event as EventRef).starts_at <= now),
        attended: s.status === "confirmed" && s.checked_in_at != null,
        imported: s.imported_at != null,
      })),
  ].sort((a, b) => b.event.starts_at.localeCompare(a.event.starts_at) || a.key.localeCompare(b.key));
  const upcoming = history.filter((h) => h.event.starts_at > now && h.event.status !== "cancelled");
  const attendedEvents = new Set(history.filter((h) => h.attended && h.event.status !== "cancelled").map((h) => h.event.id));
  const historySummary = [
    `Attended ${attendedEvents.size} ${attendedEvents.size === 1 ? "event" : "events"}`,
    member?.last_seen && `last ${formatCertDate(member.last_seen)}`,
    upcoming.length > 0 && `${upcoming.length} upcoming`,
  ]
    .filter(Boolean)
    .join(" · ");

  // ---- Profile sections ------------------------------------------------------------
  const registrationFields: Record<string, string> = {};
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) {
      registrationFields[field.key] = profileValueFromColumn(field, profile[field.key]);
    }
  }
  const sections = REGISTRATION_SECTIONS.filter((s) => s.kind !== "waiver");

  const outreach: OutreachEntry[] = (touches ?? []).map((t) => ({
    id: t.id as number,
    on: t.touched_on as string,
    type: t.touch_type as string,
    by: t.logged_by_name as string,
    note: t.note as string | null,
  }));

  const waivers = (signatures ?? []) as unknown as {
    signed_name: string;
    signed_at: string;
    waiver: { audience: string; year: number; title: string } | null;
  }[];
  const latestHealthYear = ((healthYears ?? []) as { latest_year: number }[])[0]?.latest_year ?? null;
  const address = [
    profile.address_line1,
    profile.address_line2,
    [profile.city, [profile.state, profile.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{name}</h1>
          {member && <MemberBandBadge band={member.band} />}
          {role !== "participant" && <Badge variant="outline">{ROLE_LABELS[role]}</Badge>}
          {profile.access_removed_at && (
            <Badge variant="outline" className="border-red-500/50 text-red-700 dark:text-red-400">
              Access removed
            </Badge>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {phone && (
            <a href={`tel:${phone.replace(/\D/g, "")}`} className="hover:underline">
              {phone}
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`} className="hover:underline">
              {email}
            </a>
          )}
          {chapter && <ChapterTag chapter={chapter} />}
        </p>
        {address && <p className="text-sm text-muted-foreground">{address}</p>}
        {member && (
          <p className="text-sm">
            {attendanceSummary(member, today)} · <LastOutreach member={member} today={today} />
          </p>
        )}
      </div>

      <CollapsibleCard title="Contact details" summary="Name, phone, home chapter and address" defaultOpen>
        <ContactDetailsForm
          userId={userId}
          email={email}
          chapters={chapters}
          initial={{
            first_name: (profile.first_name as string | null) ?? "",
            last_name: (profile.last_name as string | null) ?? "",
            phone,
            chapter: homeChapterOption(chapter, chapters),
            address_line1: (profile.address_line1 as string | null) ?? "",
            address_line2: (profile.address_line2 as string | null) ?? "",
            city: (profile.city as string | null) ?? "",
            state: (profile.state as string | null) ?? "",
            postal_code: (profile.postal_code as string | null) ?? "",
          }}
        />
      </CollapsibleCard>

      {sections.map((section) => (
        <CollapsibleCard
          key={section.id}
          id={section.id}
          title={section.title}
          summary={isSectionAnswered(section, registrationFields) ? section.summary(registrationFields) : "Not answered yet"}
        >
          <ProfileSectionForm userId={userId} sectionId={section.id} initial={registrationFields} />
        </CollapsibleCard>
      ))}

      <CollapsibleCard
        id="outreach"
        title="Outreach"
        summary={
          outreach.length === 0
            ? "None logged yet"
            : `${outreach.length} logged · last ${formatCertDate(outreach[0].on)} by ${outreach[0].by}`
        }
        defaultOpen={member?.needsOutreach ?? false}
      >
        <PersonOutreach memberId={userId} today={today} entries={outreach} />
      </CollapsibleCard>

      <CollapsibleCard id="history" title="Participation history" summary={historySummary}>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No RSVPs or volunteer shifts yet.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {history.map((h) => (
              <li key={h.key} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="w-28 shrink-0 text-muted-foreground">
                  {formatDateInZone(h.event.starts_at, h.event.timezone)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <Link href={`/protected/admin/events/${h.event.id}`} className="font-medium hover:underline">
                    {h.event.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {h.what}
                    {h.event.status === "cancelled" && " · event cancelled"}
                    {h.imported && " · imported"}
                    {h.event.chapter && ` · ${h.event.chapter}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="roles"
        title="Site role & access"
        summary={[
          role === "chapter_lead" && ((profile.led_chapters as string[] | null) ?? []).length > 0
            ? `Chapter lead: ${((profile.led_chapters as string[] | null) ?? []).join(", ")}`
            : ROLE_LABELS[role],
          profile.can_view_volunteer_screening && "screening notes",
          profile.can_view_health_history && "health histories",
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <PersonRoles
          isSelf={userId === adminCheck.actor.userId}
          chapterOptions={eventChapterNames(chapters)}
          person={{
            id: userId,
            name,
            email,
            chapter: chapter ?? "",
            role,
            ledChapters: (profile.led_chapters as string[] | null) ?? [],
            canViewScreening: Boolean(profile.can_view_volunteer_screening),
            canViewHealthHistory: Boolean(profile.can_view_health_history),
            accessRemovedAt: (profile.access_removed_at as string | null) ?? null,
          }}
        />
      </CollapsibleCard>

      <VolunteerSection
        userId={userId}
        name={name}
        email={email}
        profile={profile}
        timeZone={timeZone}
        actorUserId={adminCheck.actor.userId}
      />

      <CollapsibleCard
        id="forms"
        title="Waivers & health form"
        summary={[
          waivers.length === 0 ? "No waivers signed" : `${waivers.length} ${waivers.length === 1 ? "waiver" : "waivers"} signed`,
          latestHealthYear != null ? `health form ${latestHealthYear}` : "no health form",
        ].join(" · ")}
      >
        <div className="flex flex-col gap-3 text-sm">
          {waivers.length === 0 ? (
            <p className="text-muted-foreground">No waivers signed.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {waivers.map((w, i) => (
                <li key={i}>
                  {w.waiver?.title ?? "Waiver"}
                  {w.waiver?.audience === "volunteer" && " (volunteer)"}: signed &ldquo;{w.signed_name}&rdquo; on{" "}
                  {formatDateInZone(w.signed_at, timeZone)}
                </li>
              ))}
            </ul>
          )}
          {/* Only whether one is on file: health content stays behind the
            * logged health read functions (see CLAUDE.md). */}
          <p>
            Health form: {latestHealthYear != null ? `latest on file is ${latestHealthYear}` : "none on file"}
          </p>
        </div>
      </CollapsibleCard>

      <p className="text-sm text-muted-foreground">
        Same person with another login?{" "}
        <Link href={`/protected/admin/people/${userId}/merge`} className="underline underline-offset-4">
          Merge with another profile
        </Link>
      </p>
    </div>
  );
}

/**
 * An admin's page for anyone with an account: their details, every
 * registration section, outreach and participation history, site role and
 * access, and their whole volunteer record, all editable here. Reached from
 * a name on Members, Team & access, or Certifications.
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <Link href="/protected/members?chapter=all&view=everyone" className="text-sm underline underline-offset-4">
        ← Members
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <PersonLoader userId={id} />
      </Suspense>
    </div>
  );
}
