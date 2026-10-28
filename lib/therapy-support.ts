/**
 * Therapy Support: shared labels and types. Who may see what is decided in
 * the database (can_manage_therapy_support(): an admin AND the flag; see
 * the 2026-10-28 "Therapy Support, part 1" entry in schema-changes.sql), and
 * every read goes through lib/therapy-access.ts.
 *
 * Nothing from here may reach Members, rosters, the digests, or any screen
 * a chapter lead or event lead can open. Store no clinical information:
 * names, dates, counts and dollar amounts only.
 */

export const SESSIONS_PER_APPROVAL = 12;

/** The least a scholarship participant pays their therapist per session
 * themselves (the Support page says so). */
export const PARTICIPANT_SHARE_DOLLARS = 20;

export const SUPPORT_PROGRAMS = ["scholarship", "partner"] as const;
export type SupportProgram = (typeof SUPPORT_PROGRAMS)[number];

export const PROGRAM_LABELS: Record<SupportProgram, string> = {
  scholarship: "Scholarship",
  partner: "Partner office",
};

export const SUPPORT_STATUSES = ["submitted", "approved", "declined", "waitlisted", "complete"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const STATUS_LABELS: Record<SupportStatus, string> = {
  submitted: "Submitted",
  approved: "Approved",
  declined: "Declined",
  waitlisted: "Waitlisted",
  complete: "Complete",
};

export const isSupportProgram = (v: unknown): v is SupportProgram =>
  typeof v === "string" && (SUPPORT_PROGRAMS as readonly string[]).includes(v);
export const isSupportStatus = (v: unknown): v is SupportStatus =>
  typeof v === "string" && (SUPPORT_STATUSES as readonly string[]).includes(v);

export type InsuranceAnswer = "yes" | "no" | "not_sure";
export const INSURANCE_LABELS: Record<InsuranceAnswer, string> = {
  yes: "Yes",
  no: "No",
  not_sure: "Not sure",
};

export type ContactPreference = "email" | "phone" | "text";
export const CONTACT_LABELS: Record<ContactPreference, string> = {
  email: "Email",
  phone: "Phone call",
  text: "Text",
};

/** What the participant fills in. Only one program's fields are kept. */
export type SupportRequestInput = {
  program: SupportProgram | "";
  therapistName: string;
  therapistPractice: string;
  therapistEmail: string;
  therapistPhone: string;
  therapistLicenseType: string;
  therapistLicenseState: string;
  hasInsurance: InsuranceAnswer | "";
  contactPreference: ContactPreference | "";
  availability: string;
  note: string;
};

/** my_support_requests(): status and sessions only. */
export type OwnSupportRequest = {
  id: number;
  program: SupportProgram;
  status: SupportStatus;
  submittedAt: string;
  isRenewal: boolean;
  sessionsApproved: number | null;
  sessionsUsed: number;
  canRenew: boolean;
};

/** therapy_admin_requests(): one row of the review list. */
export type AdminSupportRequestRow = {
  id: number;
  userId: string | null;
  fullName: string;
  chapter: string | null;
  region: string | null;
  program: SupportProgram;
  status: SupportStatus;
  submittedAt: string;
  renewalOf: number | null;
  sessionsApproved: number | null;
  sessionsUsed: number;
  checkins: number;
  lastCheckin: string | null;
  priorApprovals: number;
  waitlistMonth: string | null;
};

export type Therapist = {
  id: number;
  name: string;
  practice: string | null;
  email: string | null;
  phone: string | null;
  license_type: string | null;
  license_state: string | null;
};

/** therapy_admin_request(): the request row plus what the review needs. */
export type AdminSupportRequest = {
  id: number;
  user_id: string | null;
  program: SupportProgram;
  status: SupportStatus;
  renewal_of: number | null;
  chapter: string | null;
  region: string | null;
  submitted_at: string;
  therapist_name: string | null;
  therapist_practice: string | null;
  therapist_email: string | null;
  therapist_phone: string | null;
  therapist_license_type: string | null;
  therapist_license_state: string | null;
  has_insurance: InsuranceAnswer | null;
  contact_preference: ContactPreference | null;
  availability: string | null;
  note: string | null;
  therapist_id: number | null;
  rate_cents: number | null;
  rate_agreed_at: string | null;
  sessions_approved: number | null;
  approved_at: string | null;
  referred_at: string | null;
  waitlist_month: string | null;
  eligibility_override_reason: string | null;
  status_changed_at: string;
  sessions_used: number;
  person: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    chapter: string | null;
  } | null;
  checkins: number;
  last_checkin: string | null;
  therapist: Therapist | null;
  approved_by_name: string | null;
  history: {
    id: number;
    program: SupportProgram;
    status: SupportStatus;
    submitted_at: string;
    approved_at: string | null;
    renewal_of: number | null;
    sessions_approved: number | null;
    sessions_used: number;
    therapist_name: string | null;
  }[];
};

export type TherapySettings = {
  scholarship_rate_cents: number | null;
  partner_monthly_sessions: number;
  updated_at: string;
};

export type PartnerUsage = { month: string; used: number; slots: number; waitlistedNextMonth: number };

/** "$60" or "$62.50". */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-11-01" → "November 2026". */
export function formatMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** "12.50" / "$60" → 1250 / 6000; null when it isn't a non-negative amount. */
export function parseDollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
