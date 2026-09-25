import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";

async function Gate({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const access = await loadEventAdminAccess(supabase);
  if (!access || (access.role !== "admin" && access.role !== "chapter_lead")) redirect("/protected/admin");
  return <>{children}</>;
}

/**
 * Volunteer applications: admins (every application) and chapter leads (the
 * ones that picked a chapter they lead). RLS on volunteer_applications is
 * what limits the rows; this keeps everyone else off the page.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
