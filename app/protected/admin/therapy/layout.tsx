import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { canManageTherapySupport } from "@/lib/therapy-access";

async function Gate({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  // Not found, not "not allowed": someone without access shouldn't learn
  // there's anything here.
  if (!(await canManageTherapySupport(supabase))) notFound();
  return <>{children}</>;
}

/**
 * Therapy Support: an admin WITH profiles.can_manage_therapy_support only.
 * Being an admin isn't enough. The database enforces the same rule on every
 * read and write (lib/therapy-access.ts); this keeps everyone else off the
 * pages.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
