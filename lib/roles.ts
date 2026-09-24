/** profiles.role — see the 2026-09-24 "chapter lead privileges" entry in
 * schema-changes.sql. Plain data, safe to import from client components. */
export type Role = "participant" | "chapter_lead" | "admin";

export const ROLE_LABELS: Record<Role, string> = {
  participant: "Participant",
  chapter_lead: "Chapter lead",
  admin: "Admin",
};
