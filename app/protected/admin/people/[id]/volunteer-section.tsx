import { createClient } from "@/lib/supabase/server";
import { ExperienceAnswers } from "@/components/application-answers";
import { CollapsibleCard } from "@/components/collapsible-card";
import { CertificationActions } from "@/components/admin/certification-actions";
import { PracticalChecksPanel } from "@/components/admin/practical-checks-panel";
import { VolunteerAdminNotes } from "@/components/admin/volunteer-admin-notes";
import { VolunteerInviteButton } from "@/components/admin/volunteer-invite-button";
import { VolunteerNotes } from "@/components/admin/volunteer-notes";
import { VolunteerRoleApprovals, type RoleTypeForApproval } from "@/components/admin/volunteer-role-approvals";
import { VolunteerStatusSelect } from "@/components/admin/volunteer-status-select";
import { Badge } from "@/components/ui/badge";
import { loadPracticalChecks } from "@/lib/admin/practical-checks";
import { certState, formatCertDate } from "@/lib/certifications";
import { formatDateInZone } from "@/lib/format-date";
import type { ExperienceRow } from "@/lib/volunteer-applications";
import {
  accountStateOf,
  certIsCurrent,
  VOLUNTEER_STATUS_LABELS,
  type AccountState,
  type VolunteerStatus,
} from "@/lib/volunteers";

type Profile = Record<string, unknown>;

/**
 * The Volunteer card on someone's profile: everything that was the separate
 * volunteer record page. Status and sign-in state with an invite button,
 * role approvals, certifications, the practical check, what they confirmed
 * at registration, notes, and screening notes for those allowed to see
 * them. For someone not on the team, a button to invite them.
 */
export async function VolunteerSection({
  userId,
  name,
  email,
  profile,
  timeZone,
  actorUserId,
}: {
  userId: string;
  name: string;
  email: string;
  /** Their profiles row (select *). */
  profile: Profile;
  timeZone: string;
  actorUserId: string;
}) {
  const supabase = await createClient();
  const { data: volunteer } = await supabase.from("volunteers").select("*").eq("user_id", userId).maybeSingle();

  if (!volunteer) {
    return (
      <CollapsibleCard id="volunteer" title="Volunteer" summary="Not on the volunteer team">
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Not on the volunteer team. Inviting them emails a link to the volunteer registration form (and sets up
            their sign-in if they&apos;ve never had one). People can also apply themselves from the Volunteer page.
          </p>
          {email && <VolunteerInviteButton email={email} name={name} label="Invite to volunteer" />}
        </div>
      </CollapsibleCard>
    );
  }

  const status = volunteer.status as VolunteerStatus;
  const [
    { data: viewer },
    { data: roleTypes },
    { data: approvals },
    { data: certs },
    { data: notes },
    { data: registration },
    accountStates,
    practical,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, can_view_volunteer_screening")
      .eq("id", actorUserId)
      .maybeSingle(),
    supabase
      .from("volunteer_role_types")
      .select("id, name, requires_cert, active")
      .order("sort_order", { ascending: true }),
    supabase.from("volunteer_role_approvals").select("id, role_type_id").eq("volunteer_id", userId).is("revoked_at", null),
    supabase
      .from("volunteer_certifications")
      .select("id, file_path, issued_on, expires_on, verified_at")
      .eq("volunteer_id", userId)
      .order("created_at", { ascending: false }),
    supabase.from("volunteer_notes").select("notes").eq("volunteer_id", userId).maybeSingle(),
    supabase.from("volunteer_registration_details").select("*").eq("volunteer_id", userId).maybeSingle(),
    supabase.rpc("admin_volunteer_account_states", { p_user_ids: [userId] }),
    loadPracticalChecks(supabase, userId),
  ]);
  const canViewScreening = Boolean(viewer?.can_view_volunteer_screening);
  const { data: screening } = canViewScreening
    ? await supabase.from("volunteer_screening_notes").select("admin_notes").eq("volunteer_id", userId).maybeSingle()
    : { data: null };

  const account: AccountState | null = accountStates.error
    ? null
    : accountStateOf(
        ((accountStates.data ?? []) as { last_sign_in_at: string | null }[])[0]?.last_sign_in_at,
        volunteer.invited_at as string | null,
      );

  const approvalByRoleType = new Map((approvals ?? []).map((a) => [a.role_type_id, a.id as number]));
  // Turned-off role types aren't offered, but one this person still holds
  // stays listed so it can be revoked.
  const roleTypesForApproval: RoleTypeForApproval[] = (roleTypes ?? [])
    .filter((rt) => rt.active || approvalByRoleType.has(rt.id))
    .map((rt) => ({
      id: rt.id as number,
      name: rt.name as string,
      requires_cert: rt.requires_cert as boolean,
      activeApprovalId: approvalByRoleType.get(rt.id as number) ?? null,
    }));
  const approvedRoles = roleTypesForApproval.filter((rt) => rt.activeApprovalId != null);
  const certRows = (certs ?? []) as {
    id: number;
    file_path: string | null;
    issued_on: string | null;
    expires_on: string | null;
    verified_at: string | null;
  }[];
  const hasCurrentCert = certRows.some(certIsCurrent);
  const certMissing = approvedRoles.some((rt) => rt.requires_cert) && !hasCurrentCert;
  const registered = volunteer.registered_at != null;
  const text = (key: string) => ((profile[key] as string | null | undefined) ?? "").trim();
  const list = (key: string) => ((profile[key] as string[] | null | undefined) ?? []).filter((v) => v !== "Other");

  const summary = [
    VOLUNTEER_STATUS_LABELS[status] ?? status,
    !registered && "not registered",
    approvedRoles.length > 0 ? approvedRoles.map((rt) => rt.name).join(", ") : "no roles yet",
    certMissing && "First Aid/CPR missing or expired",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <CollapsibleCard id="volunteer" title="Volunteer" summary={summary}>
      <div className="flex flex-col gap-5 text-sm">
        {status === "approved" && !registered && (
          <Alert title="Approved, but not registered">
            They haven&apos;t completed volunteer registration, where this year&apos;s volunteer waiver is signed, so
            they can&apos;t sign up for a shift. An admin can still add them to one from the event roster.
          </Alert>
        )}
        {approvedRoles.length > 0 && status !== "approved" && (
          <Alert title={`Approved for ${approvedRoles.map((rt) => rt.name).join(", ")}, but not an approved volunteer`}>
            Their status is {VOLUNTEER_STATUS_LABELS[status] ?? status}, so they can&apos;t sign up for any of these
            roles. Change their status to Approved when they&apos;re ready.
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <VolunteerStatusSelect volunteerId={userId} status={status} />
          <AccountStateLabel account={account} timeZone={timeZone} />
          {email && (status === "invited" || (account != null && account.kind !== "active")) && (
            <VolunteerInviteButton email={email} name={name} label="Re-send invite" />
          )}
        </div>

        <Subsection title="Role approvals">
          <VolunteerRoleApprovals
            volunteerId={userId}
            volunteerName={name}
            volunteerStatus={status}
            roleTypes={roleTypesForApproval}
            hasCurrentCert={hasCurrentCert}
          />
        </Subsection>

        <Subsection title="First Aid/CPR/AED">
          {certRows.length === 0 ? (
            <p className="text-muted-foreground">None on file.</p>
          ) : (
            certRows.map((c) => {
              const state = certState(c.expires_on);
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 border-b pb-2 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    Issued {formatCertDate(c.issued_on)}, expires {formatCertDate(c.expires_on)}
                    <Badge variant={state === "expired" ? "destructive" : state === "expiring" ? "outline" : "secondary"}>
                      {state === "expired" ? "Expired" : state === "expiring" ? "Expiring soon" : "Current"}
                    </Badge>
                  </span>
                  <CertificationActions
                    certId={c.id}
                    hasFile={Boolean(c.file_path)}
                    verifiedLabel={c.verified_at ? `Verified ${formatCertDate(c.verified_at.slice(0, 10))}` : null}
                  />
                </div>
              );
            })
          )}
        </Subsection>

        <Subsection title="Practical instruction check">
          <PracticalChecksPanel
            userId={userId}
            checks={practical.checks}
            recorderNames={practical.recorderNames}
            canRecord
            defaultAssessor={[viewer?.first_name, viewer?.last_name].filter(Boolean).join(" ")}
          />
        </Subsection>

        <Subsection title="Registration">
          <p className="text-muted-foreground">
            {registration
              ? `Confirmed at registration, ${formatDateInZone(registration.confirmed_at as string, timeZone)}.`
              : "Not registered yet: these are asked on the registration form."}
          </p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <DetailRow label="Date joined" value={volunteer.joined_on as string | null} />
            <DetailRow label="18 or older" value={volunteer.is_18_plus ? "Yes" : "Not confirmed"} />
            <DetailRow label="T-shirt size" value={text("tshirt_size")} />
            <DetailRow label="Favorite snack" value={text("favorite_snack")} />
            <DetailRow label="Favorite N/A beverage" value={text("favorite_na_beverage")} />
            <DetailRow
              label="Skills / interests"
              value={[...list("skill_interests"), text("skill_interests_other") && `Other: ${text("skill_interests_other")}`]
                .filter(Boolean)
                .join(", ")}
            />
            <DetailRow label="Program interests" value={list("program_interests").join(", ")} />
          </div>
          {registration && <ExperienceAnswers row={registration as ExperienceRow} />}
        </Subsection>

        <Subsection title="Notes">
          <VolunteerNotes volunteerId={userId} initialNotes={(notes?.notes as string | undefined) ?? ""} />
        </Subsection>

        {canViewScreening && (
          <Subsection title="Screening notes">
            <VolunteerAdminNotes
              volunteerId={userId}
              initialNotes={(screening as { admin_notes: string | null } | null)?.admin_notes ?? ""}
            />
          </Subsection>
        )}
      </div>
    </CollapsibleCard>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Alert({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400"
    >
      <p className="font-semibold">{title}</p>
      <p>{children}</p>
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

/** Whether they can sign in yet. */
function AccountStateLabel({ account, timeZone }: { account: AccountState | null; timeZone: string }) {
  if (!account) return <span className="text-muted-foreground">Sign-in: unknown</span>;
  if (account.kind === "active") return <span className="text-green-700 dark:text-green-400">Has signed in</span>;
  if (account.kind === "invited") {
    return (
      <span className="text-amber-700 dark:text-amber-400">
        Never signed in · invited {formatDateInZone(account.invitedAt, timeZone)}
      </span>
    );
  }
  return <span className="text-muted-foreground">Never signed in</span>;
}
