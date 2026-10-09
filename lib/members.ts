/**
 * Members (backlog item 4): engagement bands, when someone next needs
 * outreach, and drop alerts — all worked out from activity each time, never
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
 *
 * "Outreach" on the page is a "touch" in the code and database
 * (member_touches): a logged call, text, email or conversation.
 */

export type MemberSettings = {
  newDays: number;
  activeDays: number;
  droppedDays: number;
  touchActiveDays: number;
  touchQuietFirstDays: number;
  touchQuietRepeatDays: number;
  touchDroppedDays: number;
  droppedMaxAttempts: number;
  dropAlertDays: number;
  regularCheckins: number;
};

export const DEFAULT_MEMBER_SETTINGS: MemberSettings = {
  newDays: 14,
  activeDays: 60,
  droppedDays: 120,
  touchActiveDays: 90,
  touchQuietFirstDays: 14,
  touchQuietRepeatDays: 30,
  touchDroppedDays: 90,
  droppedMaxAttempts: 3,
  dropAlertDays: 45,
  regularCheckins: 3,
};

/** app_settings column for each setting (Setup → Members). */
export const MEMBER_SETTING_COLUMNS: Record<keyof MemberSettings, string> = {
  newDays: "members_new_days",
  activeDays: "members_active_days",
  droppedDays: "members_dropped_days",
  touchActiveDays: "members_touch_active_days",
  touchQuietFirstDays: "members_touch_quiet_first_days",
  touchQuietRepeatDays: "members_touch_quiet_repeat_days",
  touchDroppedDays: "members_touch_dropped_days",
  droppedMaxAttempts: "members_dropped_max_attempts",
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

/** Someone who came once gets their "come back" nudge this long after the
 * visit (8 weeks). */
export const ONE_VISIT_NUDGE_DAYS = 56;

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
  /** Every touch on or after their last check-in, newest first. */
  touches_since_seen: string[] | null;
};

export type Member = MemberStats & {
  name: string;
  band: MemberBand;
  /** When they next need a touch; null when their band has no schedule. */
  dueOn: string | null;
  /** Due for outreach: their touch is due, or a drop alert is open. On the
   * page this is all "Needs outreach"; a drop alert just gets there sooner. */
  needsOutreach: boolean;
  /** An open drop alert: since when (their last check-in + dropAlertDays). */
  dropAlertSince: string | null;
  /** Dropped, and droppedMaxAttempts outreach since then with no check-in:
   * they're no longer prompted. */
  outreachStopped: boolean;
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

/** Works out band, due date, needs-outreach and drop alert for one person. */
export function describeMember(stats: MemberStats, settings: MemberSettings, today: string): Member {
  const band = memberBand(stats, settings, today);
  const touch = stats.last_touch_on;
  // Attendance counts as a touch: the schedule runs from whichever is later.
  const base = later(touch, stats.last_seen);

  let dueOn: string | null = null;
  let attempts = 0;
  if (base && stats.last_seen) {
    // New: one welcome, due as soon as they first check in. Nothing more
    // until they leave New. (app_settings.members_touch_new_days is unused.)
    if (band === "new") dueOn = touch && touch >= stats.first_seen! ? null : stats.first_seen;
    // One visit: one "come back" nudge once they've been away
    // ONE_VISIT_NUDGE_DAYS, unless that visit is droppedDays+ ago (long gone,
    // e.g. imported history). Any outreach after they left New counts as the
    // nudge; the welcome while they were New doesn't.
    else if (band === "one_visit") {
      const pastNew = addDays(stats.first_seen!, settings.newDays + 1);
      const longGone = daysBetween(stats.last_seen, today) >= settings.droppedDays;
      dueOn = longGone || (touch && touch >= pastNew) ? null : addDays(stats.last_seen, ONE_VISIT_NUDGE_DAYS);
    }
    else if (band === "active") dueOn = addDays(base, settings.touchActiveDays);
    else if (band === "dropped") {
      // Every touchDroppedDays, until droppedMaxAttempts outreach since they
      // became Dropped goes unanswered (a check-in resets it: new band).
      const enteredDropped = addDays(stats.last_seen, settings.droppedDays);
      attempts = (stats.touches_since_seen ?? []).filter((d) => d >= enteredDropped).length;
      dueOn = attempts >= settings.droppedMaxAttempts ? null : addDays(base, settings.touchDroppedDays);
    }
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

  return {
    ...stats,
    name: [stats.first_name, stats.last_name].filter(Boolean).join(" ") || stats.email || "Unnamed",
    band,
    dueOn,
    needsOutreach: (dueOn != null && dueOn <= today) || dropAlertSince != null,
    dropAlertSince,
    outreachStopped: band === "dropped" && attempts >= settings.droppedMaxAttempts,
  };
}

/** "today", "yesterday", "3 days ago", "5 weeks ago", "4 months ago",
 * "over a year ago", "2 years ago": spelled out, for people new to Members. */
export function agoLabel(date: string, today: string): string {
  const days = daysBetween(date, today);
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return ago(days, "day");
  if (days < 60) return ago(Math.round(days / 7), "week");
  if (days < 365) return ago(Math.round(days / 30), "month");
  if (days < 730) return "over a year ago";
  return ago(Math.floor(days / 365), "year");
}

/** The two views of Members (?view=). */
export const MEMBER_VIEWS = { outreach: "Needs outreach", everyone: "Everyone" } as const;
export type MemberView = keyof typeof MEMBER_VIEWS;

/**
 * The sections of "Needs outreach", in order, with what each is for. Only
 * these bands ever need outreach (none has no schedule).
 */
export const OUTREACH_SECTIONS: { band: MemberBand; title: string; hint: string }[] = [
  { band: "new", title: "New", hint: "Just started coming. A welcome makes them more likely to come back." },
  { band: "one_visit", title: "One visit", hint: "Came once and hasn't been back in 8 weeks. A nudge to come again." },
  { band: "quiet", title: "Quiet", hint: "Haven't been in a while. A check-in now, before they drift off." },
  { band: "dropped", title: "Dropped", hint: "Stopped coming. Let them know they're missed." },
  { band: "active", title: "Active", hint: "Coming regularly. A routine hello." },
];

/** Since when they've needed outreach (the earlier of the due date and an
 * open drop alert), for most-overdue-first; null when they don't. */
export function outreachDueSince(m: Member): string | null {
  if (!m.needsOutreach) return null;
  // Whichever is set and earlier: a future due date is always later than an
  // open (so past) drop alert.
  return [m.dueOn, m.dropAlertSince].filter((d): d is string => d != null).sort()[0] ?? null;
}

/** Their attendance in plain words: "Came 5 times, most recently 7 months
 * ago", "Came once, 5 weeks ago", "Hasn't come to an event yet". The total,
 * not a count over a window, so it reads the same for every band. */
export function attendanceSummary(m: MemberStats, today: string): string {
  if (!m.last_seen || m.total_checkins === 0) return "Hasn't come to an event yet";
  if (m.total_checkins === 1) return `Came once, ${agoLabel(m.last_seen, today)}`;
  return `Came ${m.total_checkins} times, most recently ${agoLabel(m.last_seen, today)}`;
}
