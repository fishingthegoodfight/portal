/**
 * Members (backlog item 4): engagement bands, when someone next needs a
 * touch, and drop alerts — all worked out from activity each time, never
 * stored (2026-10-08 "Members" entry in schema-changes.sql). One
 * definition, used by the Members page and the weekly chapter email.
 * Plain functions, safe in client components. Dates are YYYY-MM-DD.
 *
 * Bands, checked in this order:
 *   none      no check-ins yet
 *   new       first check-in within newDays
 *   one_visit exactly one check-in, longer ago than that
 *   active    last check-in within activeDays
 *   quiet     last check-in activeDays–droppedDays ago
 *   dropped   last check-in droppedDays+ ago
 * Quiet and dropped always have 2+ check-ins (one is one_visit).
 */

export type MemberSettings = {
  newDays: number;
  activeDays: number;
  droppedDays: number;
  touchNewDays: number;
  touchActiveDays: number;
  touchQuietFirstDays: number;
  touchQuietRepeatDays: number;
  touchDroppedDays: number;
  dropAlertDays: number;
  regularCheckins: number;
};

export const DEFAULT_MEMBER_SETTINGS: MemberSettings = {
  newDays: 14,
  activeDays: 60,
  droppedDays: 120,
  touchNewDays: 14,
  touchActiveDays: 90,
  touchQuietFirstDays: 14,
  touchQuietRepeatDays: 30,
  touchDroppedDays: 60,
  dropAlertDays: 45,
  regularCheckins: 3,
};

/** app_settings column for each setting (Setup → Members). */
export const MEMBER_SETTING_COLUMNS: Record<keyof MemberSettings, string> = {
  newDays: "members_new_days",
  activeDays: "members_active_days",
  droppedDays: "members_dropped_days",
  touchNewDays: "members_touch_new_days",
  touchActiveDays: "members_touch_active_days",
  touchQuietFirstDays: "members_touch_quiet_first_days",
  touchQuietRepeatDays: "members_touch_quiet_repeat_days",
  touchDroppedDays: "members_touch_dropped_days",
  dropAlertDays: "members_drop_alert_days",
  regularCheckins: "members_regular_checkins",
};

export function memberSettingsFrom(row: Record<string, unknown> | null | undefined): MemberSettings {
  const settings = { ...DEFAULT_MEMBER_SETTINGS };
  for (const [key, column] of Object.entries(MEMBER_SETTING_COLUMNS) as [keyof MemberSettings, string][]) {
    const value = row?.[column];
    if (typeof value === "number" && value > 0) settings[key] = value;
  }
  return settings;
}

export const MEMBER_BANDS = ["new", "active", "quiet", "dropped", "one_visit", "none"] as const;
export type MemberBand = (typeof MEMBER_BANDS)[number];

export const BAND_LABELS: Record<MemberBand, string> = {
  new: "New",
  active: "Active",
  quiet: "Quiet",
  dropped: "Dropped",
  one_visit: "One visit",
  none: "No check-ins",
};

export const TOUCH_TYPES = ["call", "text", "in_person", "email"] as const;
export type TouchType = (typeof TOUCH_TYPES)[number];
export const TOUCH_TYPE_LABELS: Record<TouchType, string> = {
  call: "call",
  text: "text",
  in_person: "in person",
  email: "email",
};

/** One row of members_list. */
export type MemberStats = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  chapter: string | null;
  first_seen: string | null;
  last_seen: string | null;
  last_seen_event: string | null;
  total_checkins: number;
  checkins_6mo: number;
  checkins_6mo_before_last: number;
  last_touch_on: string | null;
  last_touch_type: string | null;
  last_touch_by: string | null;
  last_touch_note: string | null;
};

export type Member = MemberStats & {
  name: string;
  band: MemberBand;
  /** When they next need a touch; null when their band has no schedule. */
  dueOn: string | null;
  needsTouch: boolean;
  /** An open drop alert: since when (their last check-in + dropAlertDays). */
  dropAlertSince: string | null;
  /** The most recent contact, a logged touch or a check-in. */
  lastContact:
    | { kind: "touch"; on: string; by: string; type: string; note: string | null }
    | { kind: "checkin"; on: string; event: string | null }
    | null;
};

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export function memberBand(stats: MemberStats, settings: MemberSettings, today: string): MemberBand {
  if (!stats.first_seen || !stats.last_seen || stats.total_checkins === 0) return "none";
  if (daysBetween(stats.first_seen, today) <= settings.newDays) return "new";
  if (stats.total_checkins === 1) return "one_visit";
  const since = daysBetween(stats.last_seen, today);
  if (since <= settings.activeDays) return "active";
  if (since < settings.droppedDays) return "quiet";
  return "dropped";
}

/** Works out band, due date, needs-a-touch and drop alert for one person. */
export function describeMember(stats: MemberStats, settings: MemberSettings, today: string): Member {
  const band = memberBand(stats, settings, today);
  const touch = stats.last_touch_on;
  // Attendance counts as a touch: the schedule runs from whichever is later.
  const base = later(touch, stats.last_seen);

  let dueOn: string | null = null;
  if (base && stats.last_seen) {
    if (band === "new") dueOn = addDays(base, settings.touchNewDays);
    else if (band === "active") dueOn = addDays(base, settings.touchActiveDays);
    else if (band === "dropped") dueOn = addDays(base, settings.touchDroppedDays);
    else if (band === "quiet") {
      const enteredQuiet = addDays(stats.last_seen, settings.activeDays);
      dueOn =
        touch && touch >= enteredQuiet
          ? addDays(touch, settings.touchQuietRepeatDays)
          : addDays(enteredQuiet, settings.touchQuietFirstDays);
    }
  }

  // A regular (regularCheckins+ in the 6 months up to their last check-in)
  // who's gone dropAlertDays without one. Open until they check in again or
  // someone logs a touch on or after the alert's date: one per lapse.
  let dropAlertSince: string | null = null;
  if (stats.last_seen && stats.checkins_6mo_before_last >= settings.regularCheckins) {
    const since = addDays(stats.last_seen, settings.dropAlertDays);
    if (since <= today && !(touch && touch >= since)) dropAlertSince = since;
  }

  const lastContact: Member["lastContact"] =
    touch && (!stats.last_seen || touch >= stats.last_seen)
      ? {
          kind: "touch",
          on: touch,
          by: stats.last_touch_by ?? "Someone",
          type: TOUCH_TYPE_LABELS[stats.last_touch_type as TouchType] ?? stats.last_touch_type ?? "",
          note: stats.last_touch_note,
        }
      : stats.last_seen
        ? { kind: "checkin", on: stats.last_seen, event: stats.last_seen_event }
        : null;

  return {
    ...stats,
    name: [stats.first_name, stats.last_name].filter(Boolean).join(" ") || stats.email || "Unnamed",
    band,
    dueOn,
    needsTouch: dueOn != null && dueOn <= today,
    dropAlertSince,
    lastContact,
  };
}

/** "today", "yesterday", "3d ago", "5w ago", "4mo ago". */
export function agoLabel(date: string, today: string): string {
  const days = daysBetween(date, today);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}
