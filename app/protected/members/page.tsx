import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { MembersView, type PersonTags } from "@/components/members-view";
import { AddPersonForm } from "@/components/admin/add-person-form";
import { TeamAccess } from "@/components/admin/team-access";
import { eventChapterNames, loadChapters } from "@/lib/chapters";
import type { VolunteerStatus } from "@/lib/volunteers";
import { todayInZone } from "@/lib/format-date";
import {
  describeMember,
  MEMBER_VIEWS,
  memberSettingsFrom,
  type MemberStats,
  type MemberView,
} from "@/lib/members";

// Room for an email sent from here to go out in the background of the
// request that queued it (lib/actions/bulk-email.ts).
export const maxDuration = 300;

/** "All chapters" in the switcher (admins). */
const ALL = "all";

type MembersSearchParams = { chapter?: string; view?: string };

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Admins only: each person's site role (when above participant) and
 * volunteer status and approved roles, for the tags on Everyone and its
 * "Who" filter, plus the active role types in their usual order. */
async function loadPersonTags(
  supabase: SupabaseServerClient,
): Promise<{ tags: Record<string, PersonTags>; roleTypeNames: string[] }> {
  const [{ data: staff }, { data: volunteers }, { data: approvals }, { data: roleTypes }] = await Promise.all([
    supabase.from("profiles").select("id, role").in("role", ["admin", "chapter_lead"]),
    supabase.from("volunteers").select("user_id, status"),
    supabase
      .from("volunteer_role_approvals")
      .select("volunteer_id, role_type:volunteer_role_types(name)")
      .is("revoked_at", null),
    supabase.from("volunteer_role_types").select("name").eq("active", true).order("sort_order", { ascending: true }),
  ]);
  const tags: Record<string, PersonTags> = {};
  const tagFor = (id: string) => (tags[id] ??= {});
  for (const p of staff ?? []) tagFor(p.id as string).role = p.role as PersonTags["role"];
  for (const v of volunteers ?? []) {
    tagFor(v.user_id as string).volunteer = { status: v.status as VolunteerStatus, roles: [] };
  }
  for (const a of (approvals ?? []) as unknown as { volunteer_id: string; role_type: { name: string } | null }[]) {
    if (a.role_type) tags[a.volunteer_id]?.volunteer?.roles.push(a.role_type.name);
  }
  return { tags, roleTypeNames: (roleTypes ?? []).map((r) => r.name as string) };
}

async function MembersLoader({ searchParams }: { searchParams: Promise<MembersSearchParams> }) {
  const { chapter: requested, view: viewParam } = await searchParams;
  const requestedView: MemberView =
    viewParam && viewParam in MEMBER_VIEWS ? (viewParam as MemberView) : "outreach";
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) redirect("/auth/login");

  const [{ data: profile }, { data: myChapters }, { data: settingsRow }, chapters] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
    supabase.rpc("my_member_chapters"),
    supabase.from("app_settings").select("*").maybeSingle(),
    loadChapters(supabase),
  ]);
  const isAdmin = profile?.role === "admin";
  const view: MemberView = requestedView === "team" && !isAdmin ? "outreach" : requestedView;
  const allChapterNames = chapters.map((c) => c.name);
  const visible = isAdmin ? allChapterNames : ((myChapters ?? []) as string[]);
  // Participants (and anyone with no chapter to see) don't get the page.
  if (!isAdmin && visible.length === 0) notFound();

  const selected =
    isAdmin && (requested === ALL || !requested)
      ? ALL
      : requested && visible.includes(requested)
        ? requested
        : visible[0];

  const [{ data, error }, adminTags] = await Promise.all([
    supabase.rpc("members_list", {
      p_chapter: selected === ALL ? null : selected,
      p_all: selected === ALL,
    }),
    isAdmin ? loadPersonTags(supabase) : null,
  ]);
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load members: {error.message}</p>;

  const settings = memberSettingsFrom(settingsRow as Record<string, unknown> | null);
  const today = todayInZone("America/Denver");
  const members = ((data ?? []) as MemberStats[]).map((row) => describeMember(row, settings, today));

  return (
    <div className="flex flex-col gap-6">
      {isAdmin && <AddPersonForm chapterOptions={eventChapterNames(chapters)} />}
      <MembersView
        // A different chapter starts a fresh selection.
        key={selected}
        members={members}
        today={today}
        view={view}
        chapterOptions={isAdmin ? [ALL, ...allChapterNames] : visible}
        selected={selected}
        allValue={ALL}
        isAdmin={isAdmin}
        chapterNames={allChapterNames}
        tags={adminTags?.tags ?? null}
        roleTypeNames={adminTags?.roleTypeNames ?? []}
        team={
          view === "team" ? (
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
              <TeamAccess />
            </Suspense>
          ) : null
        }
      />
    </div>
  );
}

/**
 * Members: who needs outreach, and everyone whose home chapter is a chapter,
 * with how engaged they are and who last reached out (lib/members.ts). For admins, chapter leads
 * (the chapters they lead) and the chapter leadership team (their home
 * chapter); the database enforces it (members_list). Not the participant
 * directory, which is a separate, opt-in idea.
 *
 * Admins also manage people here: Add a person (volunteer or site role),
 * role and volunteer tags with a "Who" filter on Everyone, and the Team &
 * access tab (admins, chapter leads, sensitive-data access, removals). Each
 * name opens the person's page, where everything else about them is edited.
 */
export default function MembersPage({ searchParams }: { searchParams: Promise<MembersSearchParams> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="text-sm text-muted-foreground">
          Who to reach out to, and everyone in the chapter. Log outreach when you call, text, email or talk with
          someone, so the rest of the team knows they&apos;ve been reached.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <MembersLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
