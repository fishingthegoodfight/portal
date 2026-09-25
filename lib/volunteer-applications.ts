/**
 * Volunteer applications (table `volunteer_applications` — see the
 * 2026-09-25 "Volunteer applications, phase 1" entry in schema-changes.sql):
 * statuses, the form's options, and validation. Plain data, safe to import
 * from client components.
 *
 * Phase 1 is applying, attendance and first review. Phases 2–4 (the
 * screening call, reference checks, approval) use the statuses already
 * defined here. No criminal history question, and nothing here is behind
 * can_view_volunteer_screening.
 */

/** Meeting the attendance target puts an application straight into
 * ready_to_screen — the review queue. There's no separate "submitted". */
export const APPLICATION_STATUSES = [
  "waiting_on_attendance",
  "ready_to_screen",
  "invited_to_schedule",
  "screening_scheduled",
  "screened",
  "references_out",
  "references_in",
  "approved",
  "declined",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  waiting_on_attendance: "Waiting on attendance",
  ready_to_screen: "Ready to screen",
  invited_to_schedule: "Invited to schedule",
  screening_scheduled: "Screening scheduled",
  screened: "Screened",
  references_out: "References out",
  references_in: "References in",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

/** What the applicant sees for each status — never the internal detail. */
export const APPLICATION_STATUS_FOR_APPLICANT: Record<ApplicationStatus, string> = {
  waiting_on_attendance:
    "We've got your application. We'd love to see you at a few more events before we talk — no need to reapply, we'll pick it back up.",
  ready_to_screen: "We've got your application and will be in touch soon about a call.",
  invited_to_schedule: "We've emailed you a link to book a call with us.",
  screening_scheduled: "Your call with us is scheduled.",
  screened: "Thanks for talking with us — we're following up.",
  references_out: "We're checking in with your references.",
  references_in: "We've heard from your references and will be in touch.",
  approved: "You've been approved — welcome to the volunteer team.",
  // Nothing about applying again — that's an admin's choice (Allow
  // re-application), not the default.
  declined: "Your application is closed.",
  withdrawn: "You withdrew this application.",
};

export const CLOSED_STATUSES: ApplicationStatus[] = ["approved", "declined", "withdrawn"];

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export const AVAILABILITY_OPTIONS = [
  { value: "weeknights", label: "Weeknights" },
  { value: "weekend_mornings", label: "Weekend mornings" },
  { value: "weekend_days", label: "Full weekend days" },
  { value: "multi_day_retreats", label: "Multi-day retreats" },
] as const;
export type Availability = (typeof AVAILABILITY_OPTIONS)[number]["value"];

export function availabilityLabel(value: string): string {
  return AVAILABILITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export const BEGINNER_COMFORT_LABELS: Record<number, string> = {
  1: "1 — Not comfortable yet",
  2: "2",
  3: "3 — Comfortable with some support",
  4: "4",
  5: "5 — Very comfortable",
};

export type YesNo = "true" | "false" | "";

/** Kept apart from the interest list: it's what decides whether the
 * screening call covers retreats and on-the-water instruction. */
export const RETREAT_QUESTION =
  "Are you interested in volunteering at retreats? New retreat volunteers start as fishing instructors, working with participants on the water.";

/** Shown only when they answer yes to retreats; each must be ticked to
 * apply. Up front on the application, so nobody first hears them on the
 * call. Stored as ack_* columns, in this order. */
export const RETREAT_COMMITMENTS = [
  { key: "ackRetreatCommitment", column: "ack_retreat_commitment", label: "The commitment is the full weekend, plus annual training and a briefing the week of the retreat" },
  { key: "ackStayOnsite", column: "ack_stay_onsite", label: "Volunteers stay on-site for the whole retreat" },
  { key: "ackSharedRooms", column: "ack_shared_rooms", label: "Bedrooms are shared" },
  { key: "ackWeather", column: "ack_weather", label: "Wading and being outdoors in whatever weather we get" },
] as const;
export type RetreatCommitmentKey = (typeof RETREAT_COMMITMENTS)[number]["key"];

/** A row of volunteer_interest_areas — the plain-language "what are you
 * interested in helping with?" list, admin-editable in Setup and separate
 * from role types (roles are picked at approval). */
export type InterestArea = {
  id: number;
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
  active: boolean;
};

export function interestAreaLabel(area: Pick<InterestArea, "label" | "description">): string {
  return area.description ? `${area.label} — ${area.description}` : area.label;
}

/** The form while it's being filled in. */
export type ApplicationInput = {
  fullName: string;
  email: string;
  phone: string;
  chapters: string[];
  howConnected: string;
  howLongAttending: string;
  whyVolunteer: string;
  hopeToGet: string;
  missionConnection: string;
  interestAreaIds: number[];
  interestedInRetreats: YesNo;
  ackRetreatCommitment: boolean;
  ackStayOnsite: boolean;
  ackSharedRooms: boolean;
  ackWeather: boolean;
  yearsFlyFishing: string;
  fishingFrequency: string;
  waterFished: string;
  hasTaughtOrGuided: YesNo;
  taughtDetails: string;
  beginnerComfort: string;
  certFirstAidCpr: YesNo;
  certFirstAidCprExpires: string;
  certWfaWfr: YesNo;
  certFfiCasting: YesNo;
  certGuideLicense: YesNo;
  certOther: string;
  availability: string[];
  frequency: string;
  ref1Name: string;
  ref1Email: string;
  ref1Phone: string;
  ref1HowKnow: string;
  ref1Chapter: string;
  ref2Name: string;
  ref2Email: string;
  ref2Phone: string;
  ref2Relationship: string;
  ref2KnownFor: string;
  referencesAcknowledged: boolean;
  anythingElse: string;
};

export const EMPTY_APPLICATION: ApplicationInput = {
  fullName: "",
  email: "",
  phone: "",
  chapters: [],
  howConnected: "",
  howLongAttending: "",
  whyVolunteer: "",
  hopeToGet: "",
  missionConnection: "",
  interestAreaIds: [],
  interestedInRetreats: "",
  ackRetreatCommitment: false,
  ackStayOnsite: false,
  ackSharedRooms: false,
  ackWeather: false,
  yearsFlyFishing: "",
  fishingFrequency: "",
  waterFished: "",
  hasTaughtOrGuided: "",
  taughtDetails: "",
  beginnerComfort: "",
  certFirstAidCpr: "",
  certFirstAidCprExpires: "",
  certWfaWfr: "",
  certFfiCasting: "",
  certGuideLicense: "",
  certOther: "",
  availability: [],
  frequency: "",
  ref1Name: "",
  ref1Email: "",
  ref1Phone: "",
  ref1HowKnow: "",
  ref1Chapter: "",
  ref2Name: "",
  ref2Email: "",
  ref2Phone: "",
  ref2Relationship: "",
  ref2KnownFor: "",
  referencesAcknowledged: false,
  anythingElse: "",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every problem with an application, in form order — one rule for the form
 * and the server action. `chapterNames` is the valid chapter list. */
export function applicationErrors(input: ApplicationInput, chapterNames: string[]): string[] {
  const errors: string[] = [];
  const blank = (v: string) => !v.trim();
  const unanswered = (v: string) => v === "";

  if (blank(input.fullName)) errors.push("Your name is required");
  if (!EMAIL_PATTERN.test(input.email.trim())) errors.push("A valid email is required");
  if (blank(input.phone)) errors.push("A phone number is required");

  if (input.chapters.length === 0) errors.push("Pick at least one chapter you'd volunteer with");
  if (input.chapters.some((c) => !chapterNames.includes(c))) errors.push("Unknown chapter");
  if (blank(input.howConnected)) errors.push("Tell us how you first got connected to FTGF");
  if (blank(input.howLongAttending)) errors.push("Tell us how long you've been coming to events");

  if (blank(input.whyVolunteer)) errors.push("Tell us why you want to volunteer");
  if (blank(input.hopeToGet)) errors.push("Tell us what you hope to get out of it");

  if (input.interestAreaIds.length === 0) errors.push("Pick at least one thing you're interested in helping with");
  if (unanswered(input.interestedInRetreats)) errors.push("Answer whether you're interested in volunteering at retreats");
  if (input.interestedInRetreats === "true" && RETREAT_COMMITMENTS.some((c) => !input[c.key])) {
    errors.push("Tick each retreat commitment to apply for retreat volunteering");
  }

  if (blank(input.yearsFlyFishing)) errors.push("Tell us how many years you've been fly fishing");
  if (blank(input.fishingFrequency)) errors.push("Tell us how often you fish now");
  if (blank(input.waterFished)) errors.push("Tell us what water you fish most");
  if (unanswered(input.hasTaughtOrGuided)) errors.push("Answer whether you've taught or guided anyone");
  else if (input.hasTaughtOrGuided === "true" && blank(input.taughtDetails)) {
    errors.push("Tell us about the teaching or guiding you've done");
  }
  if (!["1", "2", "3", "4", "5"].includes(input.beginnerComfort)) {
    errors.push("Rate how comfortable you'd be teaching a complete beginner");
  }

  if (
    [input.certFirstAidCpr, input.certWfaWfr, input.certFfiCasting, input.certGuideLicense].some(unanswered)
  ) {
    errors.push("Answer each certification question");
  }
  if (input.certFirstAidCpr === "true" && !/^\d{4}-\d{2}-\d{2}$/.test(input.certFirstAidCprExpires)) {
    errors.push("Give your First Aid/CPR expiry date");
  }

  if (input.availability.length === 0) errors.push("Pick at least one time you're available");
  if (input.availability.some((a) => !AVAILABILITY_OPTIONS.some((o) => o.value === a))) {
    errors.push("Unknown availability option");
  }
  if (blank(input.frequency)) errors.push("Tell us roughly how often you could help");

  if (
    blank(input.ref1Name) || blank(input.ref1Phone) || blank(input.ref1HowKnow) || blank(input.ref1Chapter) ||
    !EMAIL_PATTERN.test(input.ref1Email.trim())
  ) {
    errors.push("Reference 1 needs a name, valid email, phone, how they know you, and their chapter");
  }
  if (
    blank(input.ref2Name) || blank(input.ref2Phone) || blank(input.ref2Relationship) || blank(input.ref2KnownFor) ||
    !EMAIL_PATTERN.test(input.ref2Email.trim())
  ) {
    errors.push("Reference 2 needs a name, valid email, phone, relationship, and how long they've known you");
  }
  const own = input.email.trim().toLowerCase();
  const r1 = input.ref1Email.trim().toLowerCase();
  const r2 = input.ref2Email.trim().toLowerCase();
  if (own && (r1 === own || r2 === own)) errors.push("A reference can't be you — give someone else's email");
  if (r1 && r1 === r2) errors.push("Your two references need to be different people");
  if (!input.referencesAcknowledged) errors.push("Tick the box to confirm we can contact both references");
  return errors;
}

/** A stored application, as the volunteer_applications row. */
export type ApplicationRecord = {
  id: number;
  user_id: string;
  status: ApplicationStatus;
  submitted_at: string;
  status_changed_at: string;
  attendance_at_submission: number;
  attendance_target: number | null;
  ready_since: string | null;
  /** Declined only: an admin has let them apply again. */
  reapplication_allowed: boolean;
  full_name: string;
  email: string;
  phone: string;
  chapters: string[];
  how_connected: string;
  how_long_attending: string;
  why_volunteer: string;
  hope_to_get: string;
  mission_connection: string | null;
  interest_area_ids: number[];
  /** Role types picked on the phase 1 form, before interest areas — kept
   * for reference, never written now. Reviewer-only. */
  legacy_role_type_ids?: number[];
  interested_in_retreats: boolean;
  /** Null on applications from before these were asked. */
  ack_retreat_commitment: boolean | null;
  ack_stay_onsite: boolean | null;
  ack_shared_rooms: boolean | null;
  ack_weather: boolean | null;
  years_fly_fishing: string;
  /** Null on applications from before this was asked. */
  fishing_frequency: string | null;
  water_fished: string;
  has_taught_or_guided: boolean;
  taught_details: string | null;
  beginner_comfort: number;
  cert_first_aid_cpr: boolean;
  cert_first_aid_cpr_expires: string | null;
  cert_wfa_wfr: boolean;
  cert_ffi_casting: boolean;
  cert_guide_license: boolean;
  cert_other: string | null;
  availability: string[];
  frequency: string;
  ref1_name: string;
  ref1_email: string;
  ref1_phone: string;
  ref1_how_know: string;
  ref1_chapter: string;
  ref1_matched_volunteer: boolean;
  ref2_name: string;
  ref2_email: string;
  ref2_phone: string;
  ref2_relationship: string;
  ref2_known_for: string;
  anything_else: string | null;
};

/** Where the attendance count points, for the review screen: the numbers
 * only suggest; the reviewer chooses. */
export function attendanceSuggestion(attended: number, target: number): "invite" | "attend_more" {
  return attended >= target ? "invite" : "attend_more";
}
