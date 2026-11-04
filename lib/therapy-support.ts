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
  w9_threshold_cents: number;
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

export const PAYMENT_METHODS = ["check", "ach", "zelle", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  check: "Check",
  ach: "Bank transfer (ACH)",
  zelle: "Zelle",
  card: "Card",
  other: "Other",
};

/** One logged session (therapy_admin_request_sessions). */
export type SessionRow = {
  id: number;
  session_date: string;
  invoice_ref: string | null;
  payment_id: number | null;
  paid_on: string | null;
};

/** therapy_admin_budget(year): an approval counts against the year it was
 * approved in. remaining is null when no budget is set for the year. */
export type BudgetSummary = {
  year: number;
  budget_cents: number | null;
  committed_cents: number;
  owed_cents: number;
  spent_cents: number;
  remaining_cents: number | null;
  approvals: number;
};

/** therapy_admin_therapist_summary(year): one row per therapist. */
export type TherapistSummaryRow = {
  therapist_id: number;
  name: string;
  practice: string | null;
  email: string | null;
  phone: string | null;
  license_type: string | null;
  license_state: string | null;
  w9_received: boolean;
  paid_cents: number;
  unpaid_sessions: number;
  unpaid_cents: number;
  needs_w9: boolean;
};

/** therapy_admin_therapist(id). */
export type TherapistDetail = Therapist & {
  w9_received: boolean;
  w9_received_at: string | null;
  w9_threshold_cents: number;
  participants: number;
  unpaid: {
    id: number;
    session_date: string;
    invoice_ref: string | null;
    request_id: number;
    person: string;
    rate_cents: number;
  }[];
  payments: {
    id: number;
    amount_cents: number;
    paid_on: string;
    method: PaymentMethod;
    reference: string | null;
    sessions: number;
  }[];
  years: { year: number; paid_cents: number }[];
};

/** therapy_admin_partner_overview(). */
export type PartnerOverview = {
  waitlist: { id: number; person: string; chapter: string | null; submitted_at: string; waitlist_month: string | null }[];
  referrals: {
    id: number;
    person: string;
    chapter: string | null;
    referred_at: string | null;
    sessions_used: number;
    sessions_approved: number;
    this_month: number;
    last_session: string | null;
  }[];
};

export const REPORT_GRAINS = ["month", "quarter", "year"] as const;
export type ReportGrain = (typeof REPORT_GRAINS)[number];

/** therapy_admin_report(): counts only. "total" is both programs together. */
export type ReportRow = {
  level: "total" | "program" | "region" | "chapter";
  period: string;
  program: SupportProgram | null;
  region: string | null;
  chapter: string | null;
  participants: number;
  sessions: number;
  dollars_cents: number;
  renewals: number;
};

/** therapy_admin_report_people(): with names, for the opt-in export. */
export type ReportPersonRow = {
  name: string;
  program: SupportProgram;
  region: string;
  chapter: string;
  sessions: number;
  dollars_cents: number;
  renewals: number;
};

/** The first day of a reporting period, as its label: "October 2026",
 * "Q4 2026", "2026". */
export function periodLabel(period: string, grain: ReportGrain): string {
  const [y, m] = period.split("-").map(Number);
  if (grain === "year") return String(y);
  if (grain === "quarter") return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  return formatMonth(period);
}

/** "2026-10-28" → "Oct 28, 2026" (a plain date, no time zone shift). */
export function formatPlainDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** [from, to) for a report: the whole calendar year. */
export function reportRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
}

export const isReportGrain = (v: unknown): v is ReportGrain =>
  typeof v === "string" && (REPORT_GRAINS as readonly string[]).includes(v);
