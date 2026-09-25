/** profiles.role — see the 2026-09-24 "chapter lead privileges" entry in
 * schema-changes.sql. Plain data, safe to import from client components. */
export type Role = "participant" | "chapter_lead" | "admin";

export const ROLE_LABELS: Record<Role, string> = {
  participant: "Participant",
  chapter_lead: "Chapter lead",
  admin: "Admin",
};

/**
 * What profiles.can_view_volunteer_screening grants someone, in words, by
 * role — for the People & roles screen. Two separate things:
 *  - the volunteer registry's screening notes: admins only
 *    (can_view_volunteer_screening());
 *  - screening calls on volunteer applications: anyone with the flag, for
 *    the applications they can already see (can_record_screening) — every
 *    one for an admin, their chapters' for a chapter lead.
 * The flag never widens which applications someone can see.
 */
export function screeningFlagGrants(role: Role, ledChapters: string[]): string {
  if (role === "admin") {
    return "Grants: the volunteer registry's screening notes, and screening calls on every volunteer application.";
  }
  if (role === "chapter_lead") {
    const chapters = ledChapters.length > 0 ? ledChapters.join(", ") : "their chapters";
    return `Grants: screening calls on volunteer applications for ${chapters}. Not the registry's screening notes — those are admins only.`;
  }
  return "Grants nothing right now: they can't see any volunteer applications, and the registry's screening notes are admins only.";
}

/** The general rule, for forms where the person's role isn't settled yet. */
export const SCREENING_FLAG_RULE =
  "As an admin: the volunteer registry's screening notes. For anyone: screening calls on the volunteer applications they can already see (all of them for an admin, their chapters' for a chapter lead). It never adds applications they can't already see.";
