/**
 * Volunteer registry domain: statuses, role types, and the catalogs behind
 * the registration form's multi-selects. See the 2026-09-22
 * schema-changes.sql entry for the tables this backs.
 */

export const VOLUNTEER_STATUSES = [
  "invited",
  "registered",
  "approved",
  "inactive",
  "declined",
] as const;
export type VolunteerStatus = (typeof VOLUNTEER_STATUSES)[number];

export const VOLUNTEER_STATUS_LABELS: Record<VolunteerStatus, string> = {
  invited: "Invited",
  registered: "Registered",
  approved: "Approved",
  inactive: "Inactive",
  declined: "Declined",
};

export type VolunteerRoleType = {
  id: number;
  key: string;
  name: string;
  description: string | null;
  for_retreats: boolean;
  for_chapter_events: boolean;
  requires_cert: boolean;
  sort_order: number;
  active: boolean;
};

/** Skills/interest areas offered on the registration form (multi-select),
 * plus a free-text "Other". */
export const SKILL_INTERESTS = [
  "Fly fishing education / instruction",
  "Mental health programming / facilitation",
  "Peer mentoring / support",
  "Event planning / hosting",
  "Photography / videography",
  "Fundraising / donor outreach",
  "Administrative support",
  "Social media",
] as const;

/** Programs a volunteer can say they're interested in supporting
 * (multi-select). */
export const PROGRAM_INTERESTS = [
  "Retreats",
  "Fish A-Longs",
  "Fly Tying Nights",
  "Men's Nights",
  "Social Events",
  "Outreach Events",
] as const;

export const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;

export const CERTIFICATION_KINDS = { first_aid_cpr_aed: "First Aid/CPR/AED" } as const;

/** A cert is "missing or expired" for the admin list's flag when the role
 * needs one and there's no row on file with a future (or no) expiry. */
export function certIsCurrent(cert: { expires_on: string | null } | null | undefined): boolean {
  if (!cert) return false;
  if (!cert.expires_on) return true;
  return new Date(cert.expires_on).getTime() >= Date.now();
}

/** Sort key + grouping for the role types admin screen: retreat-only,
 * chapter-only, then both — each group by sort_order. */
export function roleTypeGroup(role: Pick<VolunteerRoleType, "for_retreats" | "for_chapter_events">) {
  if (role.for_retreats && role.for_chapter_events) return "both" as const;
  if (role.for_retreats) return "retreats" as const;
  return "chapter_events" as const;
}

export const ROLE_TYPE_GROUP_LABELS = {
  retreats: "Retreats",
  chapter_events: "Chapter events",
  both: "Both",
} as const;
