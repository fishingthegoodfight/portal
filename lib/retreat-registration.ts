/**
 * Retreat registration: statuses, labels and the row shapes the pages read.
 * The rules (who gets a spot, holds, offers, the pre-retreat check) live in
 * the database functions of the 2026-11-04 "Retreats, part 2" entry in
 * schema-changes.sql; nothing here decides anything.
 */

export const REGISTRATION_STATUSES = [
  "pending_payment",
  "confirmed",
  "waitlisted",
  "offered",
  "expired",
  "cancelled",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Still in: holds or is waiting for a place. */
export const ACTIVE_STATUSES: RegistrationStatus[] = ["pending_payment", "confirmed", "waitlisted", "offered"];

export const STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  waitlisted: "Waitlisted",
  offered: "Spot offered",
  expired: "Offer expired",
  cancelled: "Cancelled",
};

export type RoomStatus = "pending" | "approved" | "declined";
export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};

export const ROOM_REQUEST_INTRO =
  "Individual rooms are very limited. We can give one when there's a specific need for it: a medical device, a condition, or anything else that makes sharing a room hard. Room requests don't cost anything extra.";

/** The pre-retreat check (my_retreat_precheck / retreat_registration_health). */
export type PrecheckState = "done" | "needs_confirm" | "missing";
export type MyPrecheck = {
  opens_on: string;
  due_on: string;
  state: PrecheckState;
  form_signed_at: string | null;
};

export const PRECHECK_LABELS: Record<PrecheckState, string> = {
  done: "Current",
  needs_confirm: "Needs to confirm",
  missing: "Missing",
};

/** The pre-retreat check's dates: opens 21 days before, due 14 days before. */
export const PRECHECK_OPENS_DAYS = 21;
export const PRECHECK_DUE_DAYS = 14;

export const REGISTRATION_COLUMNS =
  "id, event_id, user_id, status, price_option_id, custom_price_id, price_label, price_cents, true_cost_cents, donation_cents, room_request, room_request_reason, room_request_status, room_decided_at, registered_at, joined_waitlist_at, offered_at, offer_expires_at, hold_expires_at, confirmed_at, cancelled_at, cancel_note";

export type RegistrationRow = {
  id: number;
  event_id: number;
  user_id: string | null;
  status: RegistrationStatus;
  price_option_id: number | null;
  custom_price_id: number | null;
  price_label: string;
  price_cents: number;
  true_cost_cents: number | null;
  donation_cents: number;
  room_request: boolean;
  room_request_reason: string | null;
  room_request_status: RoomStatus | null;
  room_decided_at: string | null;
  registered_at: string;
  joined_waitlist_at: string | null;
  offered_at: string | null;
  offer_expires_at: string | null;
  hold_expires_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_note: string | null;
};

/** What the registration costs in all: the price plus any extra donation. */
export const totalCents = (r: Pick<RegistrationRow, "price_cents" | "donation_cents">) =>
  r.price_cents + r.donation_cents;

/** "2026-12-01" → "Tue, Dec 1, 2026" (a plain date, no time zone shift). */
export function formatDueDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
