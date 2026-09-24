import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { RoleTypesManager } from "@/components/admin/role-types-manager";
import type { VolunteerRoleType } from "@/lib/volunteers";

async function RoleTypesLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("volunteer_role_types")
    .select("id, key, name, description, for_retreats, for_chapter_events, requires_cert, sort_order, active")
    .order("sort_order", { ascending: true });

  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load role types: {error.message}</p>;
  }

  return <RoleTypesManager roleTypes={(data ?? []) as VolunteerRoleType[]} />;
}

export default function AdminVolunteerRoleTypesPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Volunteer role types</h1>
        <p className="text-sm text-muted-foreground">
          Deactivating hides a role from new event builds and new approvals but leaves existing
          approvals and past event roles intact. A role nothing uses yet can be deleted outright.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RoleTypesLoader />
      </Suspense>
    </div>
  );
}
