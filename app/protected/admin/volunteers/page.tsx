import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { InviteVolunteerForm } from "@/components/admin/invite-volunteer-form";
import { VolunteerFilters } from "@/components/admin/volunteer-filters";
import { VolunteersList } from "@/components/admin/volunteers-list";
import { Button } from "@/components/ui/button";
import { accountStateOf, type VolunteerStatus } from "@/lib/volunteers";

// "Send portal invite" runs on this page — a batch of up to
// PORTAL_INVITE_BATCH_LIMIT emails, spaced out, can take a while.
export const maxDuration = 120;

type VolunteerRow = {
  user_id: string;
  status: VolunteerStatus;
  invited_at: string | null;
};

type RoleApprovalRow = {
  volunteer_id: string;
  role_type_id: number;
  role_type: { name: string; requires_cert: boolean } | null;
};

async function VolunteersListLoader({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; chapter?: string; role?: string; q?: string }>;
}) {
  const { status, chapter, role, q } = await searchParams;
  const supabase = await createClient();

  let volunteersQuery = supabase
    .from("volunteers")
    .select("user_id, status, invited_at");
  if (status) volunteersQuery = volunteersQuery.eq("status", status);
  const [{ data: volunteers, error }, { data: roleTypes }] = await Promise.all([
    volunteersQuery,
    supabase.from("volunteer_role_types").select("id, name").order("sort_order", { ascending: true }),
  ]);

  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load volunteers: {error.message}</p>;
  }

  const rows = (volunteers ?? []) as VolunteerRow[];
  const ids = rows.map((r) => r.user_id);

  const [{ data: profiles }, { data: approvals }, { data: certs }, accountStates] = await Promise.all([
    ids.length > 0
      ? supabase.from("profiles").select("id, first_name, last_name, email, chapter").in("id", ids)
      : Promise.resolve({ data: [] }),
    ids.length > 0
      ? supabase
          .from("volunteer_role_approvals")
          .select("volunteer_id, role_type_id, role_type:volunteer_role_types(name, requires_cert)")
          .in("volunteer_id", ids)
          .is("revoked_at", null)
      : Promise.resolve({ data: [] }),
    ids.length > 0
      ? supabase
          .from("volunteer_certifications")
          .select("volunteer_id, expires_on")
          .in("volunteer_id", ids)
          .eq("kind", "first_aid_cpr_aed")
      : Promise.resolve({ data: [] }),
    ids.length > 0
      ? supabase.rpc("admin_volunteer_account_states", { p_user_ids: ids })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const lastSignInById = new Map(
    ((accountStates.data ?? []) as { user_id: string; last_sign_in_at: string | null }[]).map((a) => [
      a.user_id,
      a.last_sign_in_at,
    ]),
  );

  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const approvalsByVolunteer = new Map<string, RoleApprovalRow[]>();
  for (const a of (approvals ?? []) as unknown as RoleApprovalRow[]) {
    const list = approvalsByVolunteer.get(a.volunteer_id) ?? [];
    list.push(a);
    approvalsByVolunteer.set(a.volunteer_id, list);
  }
  const currentCertByVolunteer = new Map<string, boolean>();
  for (const c of (certs ?? []) as { volunteer_id: string; expires_on: string | null }[]) {
    // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request on the server (after awaiting request data), so there's no re-render or hydration to disagree with this timestamp.
    const current = !c.expires_on || new Date(c.expires_on).getTime() >= Date.now();
    if (current) currentCertByVolunteer.set(c.volunteer_id, true);
    else if (!currentCertByVolunteer.has(c.volunteer_id)) currentCertByVolunteer.set(c.volunteer_id, false);
  }

  const chapterLower = (chapter ?? "").toLowerCase();
  const qLower = (q ?? "").trim().toLowerCase();
  const roleIdFilter = role ? Number(role) : null;

  let combined = rows.map((r) => {
    const profile = profileById.get(r.user_id);
    const roleApprovals = approvalsByVolunteer.get(r.user_id) ?? [];
    const needsCert = roleApprovals.some((a) => a.role_type?.requires_cert);
    const hasCurrentCert = currentCertByVolunteer.get(r.user_id) === true;
    return {
      userId: r.user_id,
      status: r.status,
      firstName: (profile?.first_name as string | null) ?? "",
      lastName: (profile?.last_name as string | null) ?? "",
      email: (profile?.email as string | null) ?? "",
      chapter: (profile?.chapter as string | null) ?? "",
      roles: roleApprovals.map((a) => a.role_type?.name).filter(Boolean) as string[],
      roleTypeIds: roleApprovals.map((a) => a.role_type_id),
      certMissingOrExpired: needsCert && !hasCurrentCert,
      account: accountStates.error ? null : accountStateOf(lastSignInById.get(r.user_id), r.invited_at),
    };
  });

  if (chapter) combined = combined.filter((v) => v.chapter.toLowerCase() === chapterLower);
  if (roleIdFilter) combined = combined.filter((v) => v.roleTypeIds.includes(roleIdFilter));
  if (qLower) {
    combined = combined.filter((v) =>
      `${v.firstName} ${v.lastName} ${v.email}`.toLowerCase().includes(qLower),
    );
  }
  combined.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

  return (
    <div className="flex flex-col gap-4">
      <VolunteerFilters
        status={status ?? ""}
        chapter={chapter ?? ""}
        role={role ?? ""}
        q={q ?? ""}
        roleTypes={roleTypes ?? []}
      />

      {accountStates.error && (
        <p className="text-sm text-red-500">Couldn&apos;t load account states: {accountStates.error.message}</p>
      )}
      {combined.length === 0 ? (
        <p className="text-sm text-muted-foreground">No volunteers match these filters.</p>
      ) : (
        <VolunteersList volunteers={combined} />
      )}
    </div>
  );
}

export default function AdminVolunteersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; chapter?: string; role?: string; q?: string }>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl mb-1">Volunteers</h1>
          <p className="text-sm text-muted-foreground">The volunteer registry: invites, roles, and approvals.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild variant="outline">
            <Link href="/protected/admin/volunteers/import">Import volunteers</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/protected/admin/volunteers/roles">Role types</Link>
          </Button>
        </div>
      </div>
      <InviteVolunteerForm />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <VolunteersListLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
