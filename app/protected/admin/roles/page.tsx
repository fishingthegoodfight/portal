import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  RolesManager,
  type RemovalLogEntry,
  type RolePerson,
} from "@/components/admin/roles-manager";
import { InvitePersonForm } from "@/components/admin/invite-person-form";
import type { Role } from "@/lib/roles";

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

async function RolesLoader({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();

  // Everyone with a role above participant or either sensitive-data flag —
  // an event lead with the health flag is a participant by role, and still
  // has to show up here so "who can see medical?" is answerable at a glance.
  const staffQuery = supabase
    .from("profiles")
    .select(PERSON_COLUMNS)
    .or(
      "role.in.(admin,chapter_lead),can_view_volunteer_screening.is.true,can_view_health_history.is.true",
    )
    .order("role", { ascending: true })
    .order("first_name", { ascending: true });

  // Escape PostgREST's or() separators and LIKE wildcards in what was typed.
  const safe = query.replace(/[%_,()\\]/g, " ").trim();
  const searchQuery =
    safe.length >= 2
      ? supabase
          .from("profiles")
          .select(PERSON_COLUMNS)
          .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%`)
          .order("first_name", { ascending: true })
          .limit(25)
      : null;

  // Who removed whom and when (person_removal_log, admins only).
  const removalsQuery = supabase
    .from("person_removal_log")
    .select("id, action, subject_name, subject_email, actor_label, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(15);

  const [{ data: staff, error }, search, { data: removals }] = await Promise.all([
    staffQuery,
    searchQuery,
    removalsQuery,
  ]);
  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load people: {error.message}</p>;
  }

  return (
    <RolesManager
      currentUserId={(claims?.claims.sub as string | undefined) ?? ""}
      staff={((staff ?? []) as PersonRow[]).map(toPerson)}
      query={query}
      results={search ? ((search.data ?? []) as PersonRow[]).map(toPerson) : null}
      removals={((removals ?? []) as RemovalLogRow[]).map(toRemoval)}
    />
  );
}

export default function AdminRolesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">People &amp; roles</h1>
        <p className="text-sm text-muted-foreground">
          Chapter leads can create and manage events in the chapters they cover — rosters,
          check-in, walk-ups, volunteer shifts, edits and cancellations — but can&apos;t reach
          setup, the volunteer registry, approvals, or roles. Admins can do everything.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Sensitive data is separate from role: each person&apos;s row shows whether they have
          volunteer screening (the registry&apos;s screening notes for admins; screening calls on
          the applications they can see) or health histories. Neither widens what they can reach
          — they only unlock that data within it, and each row says what it grants that person.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Remove person… takes someone out: a test account or duplicate with nothing attached is
          deleted outright; anyone with history (events, waivers, an application) has their access
          removed instead, so past rosters and attendance counts stay the same.
        </p>
      </div>
      <InvitePersonForm />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RolesLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
