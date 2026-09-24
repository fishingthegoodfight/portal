import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

async function Gate({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_manage_event", { p_event_id: eventId });
  if (!allowed) notFound();
  return <>{children}</>;
}

/**
 * Every page for one event (roster, edit, print) is for whoever manages it —
 * can_manage_event. Anyone else gets a 404 rather than a page that would
 * only half-load under RLS (a published event's details are readable, its
 * roster isn't).
 */
export default function EventAdminLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <Gate params={params}>{children}</Gate>
    </Suspense>
  );
}
