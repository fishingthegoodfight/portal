import { createClient } from "@/lib/supabase/server";
import {
  RolesManager,
  type RemovalLogEntry,
  type RolePerson,
} from "@/components/admin/roles-manager";
import type { Role } from "@/lib/roles";
import { eventChapterNames, loadChapters } from "@/lib/chapters";

const PERSON_COLUMNS =
  "id, first_name, last_name, email, chapter, role, led_chapters, can_view_volunteer_screening, can_view_health_history, access_removed_at";

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  chapter: string | null;
  role: Role;
  led_chapters: string[] | null;
  can_view_volunteer_screening: boolean;
  can_view_health_history: boolean;
  access_removed_at: string | null;
};

type RemovalLogRow = {
  id: number;
  action: RemovalLogEntry["action"];
  subject_name: string | null;
  subject_email: string | null;
  actor_label: string | null;
  reason: string | null;
  created_at: string;
};

function toPerson(row: PersonRow): RolePerson {
  return {
    id: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    email: row.email ?? "",
    chapter: row.chapter ?? "",
    role: row.role,
    ledChapters: row.led_chapters ?? [],
    canViewScreening: row.can_view_volunteer_screening,
    canViewHealthHistory: row.can_view_health_history,
    accessRemovedAt: row.access_removed_at,
  };
}

function toRemoval(row: RemovalLogRow): RemovalLogEntry {
  return {
    id: row.id,
    action: row.action,
    subject:
      [row.subject_name, row.subject_email && `<${row.subject_email}>`].filter(Boolean).join(" ") ||
      "(unknown)",
    actor: row.actor_label ?? "(unknown)",
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/**
 * Members → Team & access (admins only): everyone who's an admin or chapter
 * lead or has either sensitive-data flag, everyone whose access is removed,
 * and the removal history.
 */
export async function TeamAccess() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();

  // Everyone with a role above participant or either sensitive-data flag —
  // an event lead with the health flag is a participant by role, and still
  // has to show up here so "who can see medical?" is answerable at a glance.
  // Someone whose access is removed is listed on their own below instead.
  const staffQuery = supabase
    .from("profiles")
    .select(PERSON_COLUMNS)
    .or(
      "role.in.(admin,chapter_lead),can_view_volunteer_screening.is.true,can_view_health_history.is.true",
    )
    .is("access_removed_at", null)
    .order("role", { ascending: true })
    .order("first_name", { ascending: true });

  const removedQuery = supabase
    .from("profiles")
    .select(PERSON_COLUMNS)
    .not("access_removed_at", "is", null)
    .order("access_removed_at", { ascending: false });

  // Who removed whom and when (person_removal_log, admins only).
  const removalsQuery = supabase
    .from("person_removal_log")
    .select("id, action, subject_name, subject_email, actor_label, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(15);

  const [{ data: staff, error }, { data: removed }, { data: removals }, chapters] = await Promise.all([
    staffQuery,
    removedQuery,
    removalsQuery,
    loadChapters(supabase),
  ]);
  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load people: {error.message}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          Chapter leads can create and manage events in the chapters they cover (rosters, check-in,
          walk-ups, volunteer shifts, edits and cancellations) but can&apos;t reach setup, approvals or
          roles. Admins can do everything. To change anyone else&apos;s role, open their name under
          Everyone.
        </p>
        <p>
          Sensitive data is separate from role: volunteer screening (screening notes and calls) and
          health histories only unlock that data within what the person can already reach. Each row
          says what it grants them.
        </p>
      </div>
      <RolesManager
        currentUserId={(claims?.claims.sub as string | undefined) ?? ""}
        staff={((staff ?? []) as PersonRow[]).map(toPerson)}
        removed={((removed ?? []) as PersonRow[]).map(toPerson)}
        removals={((removals ?? []) as RemovalLogRow[]).map(toRemoval)}
        chapterOptions={eventChapterNames(chapters)}
      />
    </div>
  );
}
