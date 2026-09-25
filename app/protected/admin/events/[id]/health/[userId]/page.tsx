import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadHealthHistoryForStaff } from "@/lib/health-access";
import { HealthHistoryView } from "@/components/health-history-view";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One person's health form, for staff, in the context of one event. The
 * access check and the "view" log entry both happen in the database call
 * (health_history_for_staff) — a manager without the health flag, or anyone
 * asking about someone not on this event's roster, gets nothing.
 */
async function StaffHealthLoader({ params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId) || !UUID_PATTERN.test(userId)) notFound();

  const supabase = await createClient();
  const result = await loadHealthHistoryForStaff(supabase, userId, eventId);
  if (!result.ok) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have access to this person&apos;s health information for this event.
      </p>
    );
  }

  const { data: person } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "This person";

  if (!result.data) {
    return (
      <p className="text-sm">
        <span className="font-medium">{name}</span> has no health form on file for this event&apos;s
        year.
      </p>
    );
  }
  return <HealthHistoryView record={result.data} personName={name} />;
}

export default function StaffHealthPage({ params }: { params: Promise<{ id: string; userId: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <Suspense fallback={null}>
        <BackLink params={params} />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <StaffHealthLoader params={params} />
      </Suspense>
    </div>
  );
}

async function BackLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Link href={`/protected/admin/events/${id}`} className="text-sm underline underline-offset-4">
      ← Back to the roster
    </Link>
  );
}
