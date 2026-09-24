import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { VenuesManager } from "@/components/admin/venues-manager";
import { VENUE_COLUMNS, type Venue } from "@/lib/venues";

async function VenuesLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_COLUMNS)
    .order("name", { ascending: true });

  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load venues: {error.message}</p>;
  }

  return <VenuesManager venues={(data ?? []) as Venue[]} />;
}

export default function AdminVenuesPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Venues</h1>
        <p className="text-sm text-muted-foreground">
          Picking a venue on an event copies its address onto the event, so editing, retiring or
          deleting one here never changes an event already using it. Chapter leads can add
          venues from the event forms; only admins can change or remove them.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <VenuesLoader />
      </Suspense>
    </div>
  );
}
