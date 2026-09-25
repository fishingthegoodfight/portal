import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { RolesManager, type RolePerson } from "@/components/admin/roles-manager";
import { InvitePersonForm } from "@/components/admin/invite-person-form";
import type { Role } from "@/lib/roles";

const PERSON_COLUMNS =
  "id, first_name, last_name, email, chapter, role, led_chapters, can_view_volunteer_screening, can_view_health_history";

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

  const [{ data: staff, error }, search] = await Promise.all([staffQuery, searchQuery]);
  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load people: {error.message}</p>;
  }

  return (
    <RolesManager
      currentUserId={(claims?.claims.sub as string | undefined) ?? ""}
      staff={((staff ?? []) as PersonRow[]).map(toPerson)}
      query={query}
      results={search ? ((search.data ?? []) as PersonRow[]).map(toPerson) : null}
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
          Sensitive data is separate from role: each person&apos;s row shows whether they can see
          volunteer screening notes or health histories. Neither widens what they can reach —
          they only unlock that data within it.
        </p>
      </div>
      <InvitePersonForm />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RolesLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
