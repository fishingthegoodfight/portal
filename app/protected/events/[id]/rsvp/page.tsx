import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { RsvpForm } from "@/components/rsvp-form";

async function RsvpLoader({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const userId = data.claims.sub as string;

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, name, chapter, event_type, starts_at, ends_at, location, description, capacity, spots_taken, is_published",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (!event || !event.is_published) {
    notFound();
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email, phone")
    .eq("id", userId)
    .maybeSingle();

  const { data: existingRsvp } = await supabase
    .from("rsvps")
    .select("status, dietary_notes")
    .eq("event_id", eventId)
    .maybeSingle();

  return (
    <RsvpForm
      event={event}
      profile={{
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        email: profile?.email ?? "",
        phone: profile?.phone ?? "",
      }}
      initialRsvp={
        existingRsvp
          ? {
              status: existingRsvp.status,
              dietaryNotes: existingRsvp.dietary_notes ?? "",
            }
          : null
      }
    />
  );
}

export default function EventRsvpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-lg">
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading...</p>
        }
      >
        <RsvpLoader params={params} />
      </Suspense>
    </div>
  );
}
