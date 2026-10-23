import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { attachedLines, type PersonRemovalCounts } from "@/lib/person-removal";
import { mergeFields, type MergeSide } from "@/lib/person-merge";
import type { Role } from "@/lib/roles";
import { VOLUNTEER_STATUS_LABELS, type VolunteerStatus } from "@/lib/volunteers";
import { MergePeopleForm } from "@/components/admin/merge-people-form";
import { MergeSearch } from "@/components/admin/merge-search";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function MergeLoader({ userId, searchParams }: { userId: string; searchParams: Promise<{ with?: string }> }) {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) notFound();
  const otherId = (await searchParams).with;

  if (!otherId || !UUID.test(otherId) || otherId === userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) notFound();
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email || "Unnamed";
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Merge {name} with another profile</h1>
          <p className="text-sm text-muted-foreground">
            For someone who has two profiles because they signed in with two emails. Find the other one, then
            compare the two.
          </p>
        </div>
        <MergeSearch userId={userId} />
      </div>
    );
  }

  const ids = [userId, otherId];
  const [{ data: profiles }, previewA, previewB, { data: signIns }, { data: volunteers }, { data: openApps }] =
    await Promise.all([
      supabase.from("profiles").select("*").in("id", ids),
      supabase.rpc("admin_person_removal_preview", { p_user_id: userId }),
      supabase.rpc("admin_person_removal_preview", { p_user_id: otherId }),
      supabase.rpc("admin_volunteer_account_states", { p_user_ids: ids }),
      supabase.from("volunteers").select("user_id, status").in("user_id", ids),
      supabase
        .from("volunteer_applications")
        .select("user_id")
        .in("user_id", ids)
        .not("status", "in", "(approved,declined,withdrawn)"),
    ]);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p as Record<string, unknown>]));
  const profileA = byId.get(userId);
  const profileB = byId.get(otherId);
  if (!profileA || !profileB || previewA.error || previewB.error) notFound();

  const lastSignIn = new Map(
    ((signIns ?? []) as { user_id: string; last_sign_in_at: string | null }[]).map((s) => [s.user_id, s.last_sign_in_at]),
  );
  const volunteerStatus = new Map((volunteers ?? []).map((v) => [v.user_id as string, v.status as VolunteerStatus]));
  const withOpenApp = new Set((openApps ?? []).map((a) => a.user_id as string));

  const side = (id: string, profile: Record<string, unknown>, preview: unknown): MergeSide => {
    const p = preview as { email: string | null; is_last_admin: boolean; counts: PersonRemovalCounts };
    const email = (profile.email as string | null) ?? p.email ?? "";
    const status = volunteerStatus.get(id);
    return {
      id,
      name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || email || "Unnamed",
      email,
      createdAt: (profile.created_at as string | null | undefined) ?? null,
      lastSignInAt: lastSignIn.get(id) ?? null,
      accessRemovedAt: (profile.access_removed_at as string | null) ?? null,
      role: profile.role as Role,
      isLastAdmin: p.is_last_admin,
      attached: attachedLines(p.counts),
      volunteerStatus: status ? (VOLUNTEER_STATUS_LABELS[status] ?? status) : null,
      hasOpenApplication: withOpenApp.has(id),
    };
  };
  const a = side(userId, profileA, previewA.data);
  const b = side(otherId, profileB, previewB.data);
  const viewer = adminCheck.actor.userId;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Merge duplicate profiles</h1>
        <p className="text-sm text-muted-foreground">
          {a.name} and {b.name}.{" "}
          <Link href={`/protected/admin/people/${userId}/merge`} className="underline underline-offset-4">
            Pick a different profile
          </Link>
        </p>
      </div>
      <MergePeopleForm
        a={a}
        b={b}
        fields={mergeFields(profileA, profileB)}
        // The one with more history stays unless the admin says otherwise.
        initialKeep={b.attached.length > a.attached.length ? "b" : "a"}
        viewerSide={viewer === userId ? "a" : viewer === otherId ? "b" : null}
      />
    </div>
  );
}

/**
 * Merging two profiles of the same person (admins only): from "Merge with
 * another profile" on someone's page, or a pair on Setup → Duplicate
 * profiles. Without ?with= it's a search for the other profile.
 */
export default async function MergePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ with?: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-3xl">
      <Link href={`/protected/admin/people/${id}`} className="text-sm underline underline-offset-4">
        ← Back to their page
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <MergeLoader userId={id} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
