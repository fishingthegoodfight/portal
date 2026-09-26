import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { formatDateInZone } from "@/lib/format-date";
import { timezoneForChapter } from "@/lib/chapters";
import { accountStateOf, certIsCurrent, VOLUNTEER_STATUS_LABELS, type VolunteerStatus } from "@/lib/volunteers";
import { VolunteerStatusSelect } from "@/components/admin/volunteer-status-select";
import { VolunteerRoleApprovals, type RoleTypeForApproval } from "@/components/admin/volunteer-role-approvals";
import { VolunteerAdminNotes } from "@/components/admin/volunteer-admin-notes";
import { ResendInviteButton } from "@/components/admin/resend-invite-button";
import { SendPortalInviteButton } from "@/components/admin/send-portal-invite-button";
import { AccountStateLabel } from "@/components/admin/volunteers-list";
import { VolunteerNotes } from "@/components/admin/volunteer-notes";
import { Badge } from "@/components/ui/badge";
import { PracticalChecksPanel } from "@/components/admin/practical-checks-panel";
import { loadPracticalChecks } from "@/lib/admin/practical-checks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

async function VolunteerDetailLoader({ volunteerId }: { volunteerId: string }) {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) notFound();

  const [{ data: volunteer }, { data: profile }, { data: viewerProfile }] = await Promise.all([
    supabase.from("volunteers").select("*").eq("user_id", volunteerId).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", volunteerId).maybeSingle(),
    supabase
      .from("profiles")
      .select("can_view_volunteer_screening")
      .eq("id", adminCheck.actor.userId)
      .maybeSingle(),
  ]);

  if (!volunteer) notFound();

  const canViewScreening = Boolean(viewerProfile?.can_view_volunteer_screening);

  // Latest year they have a health form on file for — not health content.
  const { data: healthYears } = await supabase.rpc("health_history_latest_years", {
    p_user_ids: [volunteerId],
  });
  const latestHealthYear =
    ((healthYears ?? []) as { latest_year: number }[])[0]?.latest_year ?? null;

  const [practical, { data: me }, { data: generalNotes }, accountStates] = await Promise.all([
    loadPracticalChecks(supabase, volunteerId),
    supabase.from("profiles").select("first_name, last_name").eq("id", adminCheck.actor.userId).maybeSingle(),
    supabase.from("volunteer_notes").select("notes").eq("volunteer_id", volunteerId).maybeSingle(),
    supabase.rpc("admin_volunteer_account_states", { p_user_ids: [volunteerId] }),
  ]);
  const account = accountStates.error
    ? null
    : accountStateOf(
        ((accountStates.data ?? []) as { last_sign_in_at: string | null }[])[0]?.last_sign_in_at,
        volunteer.invited_at as string | null,
      );

  const [{ data: allRoleTypes }, { data: activeApprovals }, { data: certs }, { data: signatures }, screeningResult] =
    await Promise.all([
      supabase.from("volunteer_role_types").select("id, name, requires_cert").order("sort_order", { ascending: true }),
      supabase
        .from("volunteer_role_approvals")
        .select("id, role_type_id")
        .eq("volunteer_id", volunteerId)
        .is("revoked_at", null),
      supabase
        .from("volunteer_certifications")
        .select("id, kind, file_path, issued_on, expires_on, verified_at")
        .eq("volunteer_id", volunteerId)
        .order("created_at", { ascending: false }),
      supabase
        .from("waiver_signatures")
        .select("signed_name, signed_at, waiver:waivers(state, audience, year, version, title)")
        .eq("user_id", volunteerId),
      canViewScreening
        ? supabase
            .from("volunteer_screening_notes")
            .select("admin_notes")
            .eq("volunteer_id", volunteerId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const approvalByRoleType = new Map((activeApprovals ?? []).map((a) => [a.role_type_id, a.id as number]));
  const roleTypesForApproval: RoleTypeForApproval[] = (allRoleTypes ?? []).map((rt) => ({
    id: rt.id as number,
    name: rt.name as string,
    requires_cert: rt.requires_cert as boolean,
    activeApprovalId: approvalByRoleType.get(rt.id as number) ?? null,
  }));
  const hasCurrentCert = (certs ?? []).some((c) => certIsCurrent(c as { expires_on: string | null }));

  const volunteerWaiverSignatures = ((signatures ?? []) as unknown as {
    signed_name: string;
    signed_at: string;
    waiver: { state: string; audience: string; year: number; version: number; title: string } | null;
  }[]).filter((s) => s.waiver?.audience === "volunteer");

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.email || volunteerId;
  const timeZone = timezoneForChapter(profile?.chapter as string | null | undefined);
  const status = volunteer.status as VolunteerStatus;
  const approvedRoleNames = roleTypesForApproval.filter((rt) => rt.activeApprovalId != null).map((rt) => rt.name);

  return (
    <div className="flex flex-col gap-6">
      {approvedRoleNames.length > 0 && status !== "approved" && (
        <div
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          <p className="font-semibold">
            Approved for {approvedRoleNames.join(", ")}, but not an approved volunteer
          </p>
          <p>
            Their status is {VOLUNTEER_STATUS_LABELS[status] ?? status}, so they can&apos;t sign up
            for any of these roles. Change their status to Approved with the status menu when they&apos;re ready.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          <p className="text-sm text-muted-foreground">{profile?.email}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <VolunteerStatusSelect volunteerId={volunteerId} status={volunteer.status} />
          <span className="text-xs">
            <AccountStateLabel account={account} chapter={(profile?.chapter as string | null) ?? ""} />
          </span>
          {account && account.kind !== "active" && profile?.email ? (
            <SendPortalInviteButton volunteerId={volunteerId} resend={account.kind === "invited"} />
          ) : (
            // Signed in but never registered: a reminder pointing at the form.
            volunteer.status === "invited" && profile?.email && <ResendInviteButton email={profile.email as string} />
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submitted info</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <DetailRow label="Phone" value={profile?.phone} />
          <DetailRow label="Home chapter" value={profile?.chapter} />
          <DetailRow label="Date joined" value={volunteer.joined_on as string | null} />
          <DetailRow
            label="Address"
            value={[profile?.address_line1, profile?.address_line2, profile?.city, profile?.state, profile?.postal_code]
              .filter(Boolean)
              .join(", ")}
          />
          <DetailRow
            label="Emergency contact"
            value={[profile?.emergency_contact, profile?.emergency_phone].filter(Boolean).join(" · ")}
          />
          <DetailRow label="T-shirt size" value={profile?.tshirt_size} />
          <DetailRow label="Favorite snack" value={profile?.favorite_snack} />
          <DetailRow label="Favorite N/A beverage" value={profile?.favorite_na_beverage} />
          <DetailRow label="18 or older" value={volunteer.is_18_plus ? "Yes" : "Not confirmed"} />
          <DetailRow
            label="Skills / interests"
            value={[
              ...((profile?.skill_interests as string[] | null) ?? []).filter((s) => s !== "Other"),
              profile?.skill_interests_other ? `Other: ${profile.skill_interests_other}` : null,
            ]
              .filter(Boolean)
              .join(", ")}
          />
          <DetailRow label="Program interests" value={(profile?.program_interests ?? []).join(", ")} />
          {/* Just what's on file: whether one is needed depends on the events
            * they volunteer at (Requires health history), shown on each roster. */}
          <DetailRow
            label="Health form"
            value={latestHealthYear != null ? `Latest on file: ${latestHealthYear}` : "None on file"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Volunteer waiver</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {volunteerWaiverSignatures.length === 0 ? (
            <p className="text-muted-foreground">Not signed yet.</p>
          ) : (
            volunteerWaiverSignatures.map((s, i) => (
              <p key={i}>
                Signed &ldquo;{s.signed_name}&rdquo; for {s.waiver?.year} ({s.waiver?.state}) on{" "}
                {formatDateInZone(s.signed_at, timeZone)}
              </p>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Certifications</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {(certs ?? []).length === 0 ? (
            <p className="text-muted-foreground">None on file.</p>
          ) : (
            (certs ?? []).map((c) => (
              <div key={c.id as number} className="flex items-center justify-between gap-3">
                <span>
                  First Aid/CPR/AED — issued {c.issued_on ?? "—"}, expires {c.expires_on ?? "—"}
                </span>
                <Badge variant={certIsCurrent(c as { expires_on: string | null }) ? "secondary" : "destructive"}>
                  {certIsCurrent(c as { expires_on: string | null }) ? "Current" : "Expired"}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Practical instruction check</CardTitle>
        </CardHeader>
        <CardContent>
          <PracticalChecksPanel
            userId={volunteerId}
            checks={practical.checks}
            recorderNames={practical.recorderNames}
            canRecord
            defaultAssessor={[me?.first_name, me?.last_name].filter(Boolean).join(" ")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role approvals</CardTitle>
        </CardHeader>
        <CardContent>
          <VolunteerRoleApprovals
            volunteerId={volunteerId}
            volunteerName={name}
            volunteerStatus={status}
            roleTypes={roleTypesForApproval}
            hasCurrentCert={hasCurrentCert}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <VolunteerNotes volunteerId={volunteerId} initialNotes={(generalNotes?.notes as string | undefined) ?? ""} />
        </CardContent>
      </Card>

      {canViewScreening && (
        <Card>
          <CardHeader>
            <CardTitle>Screening notes</CardTitle>
          </CardHeader>
          <CardContent>
            <VolunteerAdminNotes
              volunteerId={volunteerId}
              initialNotes={(screeningResult.data as { admin_notes: string | null } | null)?.admin_notes ?? ""}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>{value || "—"}</span>
    </div>
  );
}

export default async function AdminVolunteerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <VolunteerDetailLoader volunteerId={id} />
      </Suspense>
    </div>
  );
}
