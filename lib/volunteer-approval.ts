/**
 * Approving a volunteer application (phase 4 — see the 2026-09-28
 * "Volunteer applications, phase 4" entry in schema-changes.sql, where
 * volunteer_application_approve enforces the same rules). Plain data, safe
 * to import from client components.
 */

/** Among retreat roles, the only one a first-time volunteer can be approved
 * for. Anything more is added later on their volunteer record. Keep in step
 * with volunteer_application_approve. */
export const FIRST_TIME_RETREAT_ROLE_KEY = "fishing_instructor";

export type ApprovalRoleType = {
  id: number;
  key: string;
  name: string;
  for_retreats: boolean;
  for_chapter_events: boolean;
};

export function allowedForFirstTimer(role: Pick<ApprovalRoleType, "key" | "for_retreats">): boolean {
  return !role.for_retreats || role.key === FIRST_TIME_RETREAT_ROLE_KEY;
}

/**
 * The screening call's recommended roles, as a starting selection: only
 * roles still offered, and for a first-timer only the ones they can have.
 * The others are named so the admin can see what was left out and why.
 */
export function approvalPrefill(
  recommendedIds: number[],
  roles: ApprovalRoleType[],
  firstTimer: boolean,
  roleNameById: Map<number, string>,
): { selected: number[]; notForFirstTimers: string[]; turnedOff: string[] } {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const selected: number[] = [];
  const notForFirstTimers: string[] = [];
  const turnedOff: string[] = [];
  for (const id of new Set(recommendedIds)) {
    const role = byId.get(id);
    if (!role) {
      const name = roleNameById.get(id);
      if (name) turnedOff.push(name);
    } else if (firstTimer && !allowedForFirstTimer(role)) {
      notForFirstTimers.push(role.name);
    } else {
      selected.push(id);
    }
  }
  return { selected, notForFirstTimers, turnedOff };
}
