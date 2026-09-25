import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { EventTypesManager } from "@/components/admin/event-types-manager";
import type { EventTypeOption } from "@/lib/event-types";

async function EventTypesLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_types")
    .select("id, key, name, default_registration_sections, requires_health_history, sort_order, active")
    .order("sort_order", { ascending: true });

  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load event types: {error.message}</p>;
  }

  return <EventTypesManager eventTypes={(data ?? []) as EventTypeOption[]} />;
}

export default function AdminEventTypesPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Event types</h1>
        <p className="text-sm text-muted-foreground">
          Deactivating hides a type from the create wizard but never changes an event that already
          has it. A type no event or template uses can be deleted outright.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <EventTypesLoader />
      </Suspense>
    </div>
  );
}
