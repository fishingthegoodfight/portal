import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

async function Gate({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) redirect("/protected/admin");
  return <>{children}</>;
}

/**
 * Layout wrapper for the admin-only sections — setup (event types,
 * templates, volunteer role types), the volunteer registry, waivers, and
 * roles. A chapter lead who follows a stale link lands back on the events
 * index. RLS is what actually keeps them out of the data; this keeps them
 * off pages that would only show empty lists or fail to save.
 */
export function AdminOnlyGate({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
