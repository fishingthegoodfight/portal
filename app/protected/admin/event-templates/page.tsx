import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { EventTemplatesManager } from "@/components/admin/event-templates-manager";
import { TEMPLATE_WITH_ROLES_COLUMNS, type EventTemplateWithRoles } from "@/lib/event-templates";
import type { EventTypeOption } from "@/lib/event-types";

async function EventTemplatesLoader() {
  const supabase = await createClient();
  const [{ data: templates, error }, { data: roleTypes }, { data: eventTypes }] = await Promise.all([
    supabase.from("event_templates").select(TEMPLATE_WITH_ROLES_COLUMNS).order("name", { ascending: true }),
    supabase
      .from("volunteer_role_types")
      .select("id, name")
      .eq("for_chapter_events", true)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("event_types")
      .select("id, key, name, default_registration_sections, sort_order, active")
      .order("sort_order", { ascending: true }),
  ]);

  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load templates: {error.message}</p>;
  }

  return (
    <EventTemplatesManager
      templates={(templates ?? []) as unknown as EventTemplateWithRoles[]}
      roleTypes={roleTypes ?? []}
      eventTypes={(eventTypes ?? []) as EventTypeOption[]}
    />
  );
}

export default function AdminEventTemplatesPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Event templates</h1>
        <p className="text-sm text-muted-foreground">
          A reusable starting point for the create wizard. Editing or deactivating a template never
          changes an event already created from it. A template no event was created from can be
          deleted outright.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <EventTemplatesLoader />
      </Suspense>
    </div>
  );
}
