"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { approveRoleAction, revokeRoleAction } from "@/lib/actions/volunteer-admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type RoleTypeForApproval = {
  id: number;
  name: string;
  requires_cert: boolean;
  /** Set (the active approval's id) when currently approved; null otherwise. */
  activeApprovalId: number | null;
};

/** Approve/revoke controls for every role type, against one volunteer.
 * Revoking never deletes the row (see the schema note on
 * volunteer_role_approvals) — it's recorded via revoked_by/revoked_at. */
export function VolunteerRoleApprovals({
  volunteerId,
  roleTypes,
  hasCurrentCert,
}: {
  volunteerId: string;
  roleTypes: RoleTypeForApproval[];
  /** Whether a current (unexpired) First Aid/CPR/AED cert is on file — used
   * to flag "cert required, not on file" on a requires_cert role. */
  hasCurrentCert: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [certWarningFor, setCertWarningFor] = useState<number | null>(null);

  const approve = async (roleTypeId: number) => {
    setPendingId(roleTypeId);
    setError(null);
    const result = await approveRoleAction(volunteerId, roleTypeId);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.certWarning) setCertWarningFor(roleTypeId);
    router.refresh();
  };

  const revoke = async (approvalId: number) => {
    setPendingId(approvalId);
    setError(null);
    const result = await revokeRoleAction(approvalId);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-500">{error}</p>}
      {roleTypes.map((rt) => {
        const approved = rt.activeApprovalId != null;
        const flagCert = rt.requires_cert && (approved ? !hasCurrentCert : certWarningFor === rt.id);
        return (
          <div key={rt.id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{rt.name}</span>
              {approved && <Badge variant="secondary">Approved</Badge>}
              {flagCert && <Badge variant="destructive">Cert required, not on file</Badge>}
            </div>
            {approved ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingId === rt.activeApprovalId}
                onClick={() => revoke(rt.activeApprovalId as number)}
              >
                Revoke
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingId === rt.id}
                onClick={() => approve(rt.id)}
              >
                Approve
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
