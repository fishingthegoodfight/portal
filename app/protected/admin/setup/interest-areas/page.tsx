import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { InterestAreasManager } from "@/components/admin/interest-areas-manager";
import type { InterestArea } from "@/lib/volunteer-applications";

async function InterestAreasLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("volunteer_interest_areas")
    .select("id, key, label, description, sort_order, active")
    .order("sort_order", { ascending: true });
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load interest areas: {error.message}</p>;
  return <InterestAreasManager areas={(data ?? []) as InterestArea[]} />;
}

export default function InterestAreasPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Interest areas</h1>
        <p className="text-sm text-muted-foreground">
          The &ldquo;What are you interested in helping with?&rdquo; choices on the volunteer
          application, in plain language. Separate from volunteer role types: changing these never
          touches a role, and adding a role never changes the form. Turned-off areas stay on
          applications that already picked them.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <InterestAreasLoader />
      </Suspense>
    </div>
  );
}
