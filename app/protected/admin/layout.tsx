import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

async function AdminGate({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const userId = data.claims.sub as string;

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.is_admin) {
    redirect("/protected/events");
  }

  return <>{children}</>;
}

/**
 * Single choke point for every /protected/admin/* route: only members with
 * profiles.is_admin get past here, everyone else is bounced back to the
 * events list. The auth/admin check is cookie-based (dynamic), so it's
 * wrapped in its own Suspense boundary here rather than left bare in the
 * layout — same reasoning as the per-page loaders under app/protected/*.
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
