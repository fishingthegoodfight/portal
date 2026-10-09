import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { MembersView } from "@/components/members-view";
import { loadChapters } from "@/lib/chapters";
import { todayInZone } from "@/lib/format-date";
import {
  describeMember,
  MEMBER_VIEWS,
  memberSettingsFrom,
  type MemberStats,
  type MemberView,
} from "@/lib/members";

/** "All chapters" in the switcher (admins). */
const ALL = "all";

type MembersSearchParams = { chapter?: string; view?: string };

async function MembersLoader({ searchParams }: { searchParams: Promise<MembersSearchParams> }) {
  const { chapter: requested, view: viewParam } = await searchParams;
  const view: MemberView = viewParam && viewParam in MEMBER_VIEWS ? (viewParam as MemberView) : "outreach";
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

  const { data, error } = await supabase.rpc("members_list", {
    p_chapter: selected === ALL ? null : selected,
    p_all: selected === ALL,
  });
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load members: {error.message}</p>;

  const settings = memberSettingsFrom(settingsRow as Record<string, unknown> | null);
  const today = todayInZone("America/Denver");
  const members = ((data ?? []) as MemberStats[]).map((row) => describeMember(row, settings, today));

  return (
    <MembersView
      members={members}
      today={today}
      view={view}
      chapterOptions={isAdmin ? [ALL, ...allChapterNames] : visible}
      selected={selected}
      allValue={ALL}
      isAdmin={isAdmin}
      chapterNames={allChapterNames}
    />
  );
}

/**
 * Members: who needs outreach, and everyone whose home chapter is a chapter,
 * with how engaged they are and who last reached out (lib/members.ts). For admins, chapter leads
 * (the chapters they lead) and the chapter leadership team (their home
 * chapter); the database enforces it (members_list). Not the participant
 * directory, which is a separate, opt-in idea.
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
