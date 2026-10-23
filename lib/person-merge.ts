/**
 * Merging two profiles of the same person (someone who signed in with two
 * emails). The work is admin_merge_people (the 2026-10-23 "Duplicate
 * profiles" entry in schema-changes.sql); this file decides which profile
 * fields the merge screen asks about and how they read. Plain data, safe to
 * import from client components.
 */

import { formatDateInZone } from "@/lib/format-date";
import { ROLE_LABELS, type Role } from "@/lib/roles";

/** Never asked about: identity, the login email (its own choice), and
 * bookkeeping. admin_merge_people refuses these too. */
const NOT_ASKED = new Set([
  "id",
  "email",
  "created_at",
  "updated_at",
  "access_removed_at",
  "lead_events_checked_at",
  "is_admin",
]);

/** Columns that only make sense together, asked as one choice. `send` is
 * what goes to admin_merge_people: the column names, or the name of a group
 * it expands itself ('access', 'sms_consent'). */
const GROUPS: { key: string; label: string; columns: string[]; send: string[] }[] = [
  {
    key: "address",
    label: "Address",
    columns: ["address_line1", "address_line2", "city", "state", "postal_code"],
    send: ["address_line1", "address_line2", "city", "state", "postal_code"],
  },
  {
    key: "emergency_1",
    label: "Emergency contact",
    columns: ["emergency_contact", "emergency_phone", "emergency_contact_relationship"],
    send: ["emergency_contact", "emergency_phone", "emergency_contact_relationship"],
  },
  {
    key: "emergency_2",
    label: "Second emergency contact",
    columns: ["emergency_contact_2", "emergency_phone_2", "emergency_contact_2_relationship"],
    send: ["emergency_contact_2", "emergency_phone_2", "emergency_contact_2_relationship"],
  },
  {
    key: "access",
    label: "Site role & access",
    columns: ["role", "led_chapters", "can_view_volunteer_screening", "can_view_health_history"],
    send: ["access"],
  },
  {
    key: "sms_consent",
    label: "Text message consent",
    columns: ["sms_consent", "sms_consent_at", "sms_consent_text", "sms_opted_out_at"],
    send: ["sms_consent"],
  },
];

const LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  phone: "Phone",
  chapter: "Home chapter",
  dietary_notes: "Dietary notes",
  sizing_notes: "Sizing notes",
  waiver_signature: "Waiver signature (old)",
  directory_opt_in: "In the participant directory",
  fly_fishing_experience: "Fly fishing experience",
  casting_hand: "Casting hand",
  needs_boots: "Needs to borrow boots",
  boot_size: "Boot size",
  needs_waders: "Needs to borrow waders",
  wader_size: "Wader size",
  needs_rod_reel: "Needs to borrow a rod and reel",
  tshirt_size: "T-shirt size",
  favorite_snack: "Favorite snack",
  favorite_na_beverage: "Favorite non-alcoholic drink",
  skill_interests: "Skill interests",
  skill_interests_other: "Skill interests (other)",
  program_interests: "Program interests",
  volunteer_opportunities_email: "Gets the volunteer opportunities email",
  chapter_emails: "Gets chapter emails",
};

const humanize = (column: string) => {
  const words = column.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

type Row = Record<string, unknown>;

const isBlank = (value: unknown) =>
  value == null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);

function plain(value: unknown): string {
  if (isBlank(value)) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value).trim();
}

function shown(groupKey: string | null, columns: string[], row: Row): string {
  if (groupKey === "access") {
    const role = (row.role as Role | null) ?? "participant";
    const led = (row.led_chapters as string[] | null) ?? [];
    return [
      role === "chapter_lead" && led.length > 0 ? `Chapter lead: ${led.join(", ")}` : ROLE_LABELS[role] ?? role,
      row.can_view_volunteer_screening && "screening notes",
      row.can_view_health_history && "health histories",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (groupKey === "sms_consent") {
    if (row.sms_consent) {
      return row.sms_consent_at
        ? `Consented ${formatDateInZone(row.sms_consent_at as string, "America/Denver")}`
        : "Consented";
    }
    return row.sms_opted_out_at
      ? `Opted out ${formatDateInZone(row.sms_opted_out_at as string, "America/Denver")}`
      : "Not asked";
  }
  if (groupKey === "address") {
    return [
      plain(row.address_line1),
      plain(row.address_line2),
      [plain(row.city), [plain(row.state), plain(row.postal_code)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join(", ");
  }
  return columns.map((c) => plain(row[c])).filter(Boolean).join(" · ");
}

/** Nothing worth keeping: the choice defaults to the other side's. */
function groupIsBlank(groupKey: string | null, columns: string[], row: Row): boolean {
  if (groupKey === "access") {
    return (
      ((row.role as string | null) ?? "participant") === "participant" &&
      !row.can_view_volunteer_screening &&
      !row.can_view_health_history
    );
  }
  if (groupKey === "sms_consent") return !row.sms_consent && row.sms_opted_out_at == null;
  return columns.every((c) => isBlank(row[c]));
}

const sameValue = (columns: string[], a: Row, b: Row) =>
  columns.every((c) => JSON.stringify(isBlank(a[c]) ? null : a[c]) === JSON.stringify(isBlank(b[c]) ? null : b[c]));

/** One question on the merge screen: a field (or group) the two profiles
 * disagree on. */
export type MergeField = {
  key: string;
  label: string;
  /** What each side has, in words; "" when blank. */
  a: string;
  b: string;
  /** Sent to admin_merge_people when the merged profile's value is picked. */
  send: string[];
  /** Which side a fresh screen picks for each choice of profile to keep: the
   * kept profile's, unless it's blank and the other isn't. */
  defaultWhenKeepingA: "a" | "b";
  defaultWhenKeepingB: "a" | "b";
};

/** Every profile field the two disagree on, in a steady order: the named
 * groups and labelled fields first, then any other column. */
export function mergeFields(a: Row, b: Row): MergeField[] {
  const grouped = new Set(GROUPS.flatMap((g) => g.columns));
  const columns = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (c) => !NOT_ASKED.has(c) && !grouped.has(c),
  );
  const ordered = [
    ...Object.keys(LABELS).filter((c) => columns.includes(c)),
    ...columns.filter((c) => !(c in LABELS)).sort(),
  ];
  const singles = ordered.map((c) => ({ key: c, label: LABELS[c] ?? humanize(c), columns: [c], send: [c], group: null }));
  const groups = GROUPS.map((g) => ({ ...g, group: g.key }));
  // Name, phone and chapter first, then address and contacts, then the rest.
  const core = new Set(["first_name", "last_name", "phone", "chapter"]);
  const personal = new Set(["address", "emergency_1", "emergency_2"]);
  const all = [
    ...singles.filter((f) => core.has(f.key)),
    ...groups.filter((g) => personal.has(g.key)),
    ...singles.filter((f) => !core.has(f.key)),
    ...groups.filter((g) => !personal.has(g.key)),
  ];

  return all
    .filter((f) => !sameValue(f.columns, a, b))
    .map((f) => {
      const aBlank = groupIsBlank(f.group, f.columns, a);
      const bBlank = groupIsBlank(f.group, f.columns, b);
      return {
        key: f.key,
        label: f.label,
        a: shown(f.group, f.columns, a),
        b: shown(f.group, f.columns, b),
        send: f.send,
        defaultWhenKeepingA: aBlank && !bBlank ? "b" : "a",
        defaultWhenKeepingB: bBlank && !aBlank ? "a" : "b",
      };
    });
}

/** One side of a merge, as the screen shows it. */
export type MergeSide = {
  id: string;
  name: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  accessRemovedAt: string | null;
  role: Role;
  isLastAdmin: boolean;
  /** What's attached, one line per kind (attachedLines). */
  attached: string[];
  volunteerStatus: string | null;
  hasOpenApplication: boolean;
};

/** A likely duplicate pair from admin_possible_duplicates. */
export type DuplicatePair = {
  reasons: ("name" | "phone")[];
  a: DuplicateSide;
  b: DuplicateSide;
};

export type DuplicateSide = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  chapter: string | null;
  role: Role;
  access_removed_at: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  rsvps: number;
  shifts: number;
  volunteer_status: string | null;
};
