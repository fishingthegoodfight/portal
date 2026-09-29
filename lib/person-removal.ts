/**
 * Removing a person (People & roles → "Remove person…"). The rules live in
 * the database — admin_remove_person_access, admin_restore_person_access and
 * admin_delete_person (the 2026-09-29 "Removing a person" entry in
 * schema-changes.sql); this file only turns their counts into words.
 * Shared by the server actions and the client panel.
 */

/** person_removal_counts() — what's attached to someone. */
export type PersonRemovalCounts = {
  rsvps: number;
  rsvps_checked_in: number;
  /** Active RSVPs to events that haven't started. */
  rsvps_upcoming: number;
  volunteer_signups: number;
  /** Confirmed shifts at events that haven't started. */
  volunteer_signups_upcoming: number;
  waiver_signatures: number;
  health_histories: number;
  health_checkin_answers: number;
  volunteer_applications: number;
  volunteer_applications_open: number;
  /** 0 or 1. */
  volunteer_record: number;
  certification_files: number;
  attendance_credits: number;
  practical_checks: number;
  events_led: number;
  events_led_upcoming: number;
  /** Records naming them as the person who did something (recorded a
   * screening, approved a role, created a venue…). */
  other_references: number;
  /** Kept whatever happens — the log is append-only. */
  health_access_log: number;
};

export type PersonRemovalPreview = {
  email: string;
  name: string | null;
  role: string;
  isSelf: boolean;
  isLastAdmin: boolean;
  accessRemovedAt: string | null;
  counts: PersonRemovalCounts;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Nothing at all attached: a test account, a duplicate, or someone who
 * signed up and never did anything — the only case deleted by default. */
export function hasNothingAttached(c: PersonRemovalCounts): boolean {
  return attachedLines(c).length === 0;
}

/** One line per kind of thing attached to them — what a full delete
 * destroys. Empty when there's nothing. */
export function attachedLines(c: PersonRemovalCounts): string[] {
  const lines: string[] = [];
  if (c.rsvps > 0) {
    const detail = [
      c.rsvps_checked_in > 0 && `${c.rsvps_checked_in} checked in`,
      c.rsvps_upcoming > 0 && `${c.rsvps_upcoming} upcoming`,
    ].filter(Boolean);
    lines.push(`${plural(c.rsvps, "RSVP", "RSVPs")}${detail.length ? ` (${detail.join(", ")})` : ""}`);
  }
  if (c.volunteer_signups > 0) {
    lines.push(
      `${plural(c.volunteer_signups, "volunteer shift signup", "volunteer shift signups")}${
        c.volunteer_signups_upcoming > 0 ? ` (${c.volunteer_signups_upcoming} upcoming)` : ""
      }`,
    );
  }
  if (c.waiver_signatures > 0) lines.push(plural(c.waiver_signatures, "signed waiver", "signed waivers"));
  if (c.health_histories > 0) lines.push(plural(c.health_histories, "health form", "health forms"));
  if (c.health_checkin_answers > 0) {
    lines.push(plural(c.health_checkin_answers, "health check-in answer", "health check-in answers"));
  }
  if (c.volunteer_applications > 0) {
    lines.push(
      `${plural(c.volunteer_applications, "volunteer application", "volunteer applications")} with ${
        c.volunteer_applications === 1 ? "its" : "their"
      } history, screening calls and references`,
    );
  }
  if (c.volunteer_record > 0) {
    lines.push(
      `Their volunteer record — role approvals, notes, registration answers${
        c.certification_files > 0 ? `, ${plural(c.certification_files, "certification file", "certification files")}` : ""
      }`,
    );
  }
  if (c.attendance_credits > 0) lines.push("An attendance credit for events before the portal");
  if (c.practical_checks > 0) lines.push(plural(c.practical_checks, "practical instruction check", "practical instruction checks"));
  if (c.events_led > 0) {
    lines.push(
      `Event lead on ${plural(c.events_led, "event", "events")}${
        c.events_led_upcoming > 0 ? ` (${c.events_led_upcoming} upcoming)` : ""
      } — the events stay, with no lead account`,
    );
  }
  if (c.other_references > 0) {
    lines.push(
      `${plural(c.other_references, "record names", "records name")} them as the person who did something (recorded a screening, approved a role…) — kept, with no name`,
    );
  }
  return lines;
}
