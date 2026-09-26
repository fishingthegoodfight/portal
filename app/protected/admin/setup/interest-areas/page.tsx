import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { InterestAreasManager } from "@/components/admin/interest-areas-manager";
import type { InterestArea } from "@/lib/volunteer-applications";

async function InterestAreasLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("volunteer_interest_areas")
    .select("id, key, kind, label, description, sort_order, active")
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
          The two lists of choices on the volunteer application — skills &amp; interest areas, and
          programs — matching the volunteer registration form&apos;s, so approval can prefill
          registration. Keep the wording the same as the registration form&apos;s for that to carry
          over. Separate from volunteer role types: changing these never touches a role. Turned-off
          areas stay on applications that already picked them.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <InterestAreasLoader />
      </Suspense>
    </div>
  );
}
