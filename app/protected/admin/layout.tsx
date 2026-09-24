import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

async function AdminGate({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const { data: hasAccess } = await supabase.rpc("has_event_admin_access");
  if (!hasAccess) {
    redirect("/protected/events");
  }

  return <>{children}</>;
}

/**
 * Single choke point for every /protected/admin/* route: admins, chapter
 * leads, and anyone who leads an event (has_event_admin_access) get past
 * here; everyone else is bounced back to the events list. Admin-only
 * sections (setup, volunteers, waivers, roles) add their own AdminOnlyGate
 * layout, and each event's pages check can_manage_event — all of it backed
 * by RLS, so this is about sending people somewhere sensible, not security.
 * The check is cookie-based (dynamic), so it's wrapped in its own Suspense
 * boundary rather than left bare in the layout — same reasoning as the
 * per-page loaders under app/protected/*.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
