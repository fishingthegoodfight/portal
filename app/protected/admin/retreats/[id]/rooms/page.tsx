import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatEventDateRange, formatEventInstant } from "@/lib/format-date";
import {
  ACTIVE_STATUSES,
  REGISTRATION_COLUMNS,
  ROOM_STATUS_LABELS,
  STATUS_LABELS,
  type RegistrationRow,
  type RoomStatus,
} from "@/lib/retreat-registration";
import { RoomDecision } from "@/components/admin/retreat-registrations";
import { RetreatAdminNav } from "@/components/admin/retreat-admin-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ORDER: RoomStatus[] = ["pending", "approved", "declined"];
const TONES: Record<RoomStatus, string> = {
  pending: "border-l-amber-500",
  approved: "border-l-green-600",
  declined: "border-l-muted-foreground",
};

/** Every room request on one retreat, side by side, so they can be weighed
 * against each other. For admins and the retreat's lead. */
async function RoomsLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) notFound();

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_manage_event", { p_event_id: eventId });
  if (!allowed) notFound();

  const [{ data: retreat }, { data: regs }] = await Promise.all([
    supabase.from("events").select("id, name, starts_at, ends_at, timezone").eq("id", eventId).eq("kind", "retreat").maybeSingle(),
    supabase
      .from("retreat_registrations")
      .select(REGISTRATION_COLUMNS)
      .eq("event_id", eventId)
      .eq("room_request", true)
      .in("status", ACTIVE_STATUSES)
      .order("registered_at"),
  ]);
  if (!retreat) notFound();
  const timezone = retreat.timezone as string;
  const rows = (regs ?? []) as unknown as RegistrationRow[];

  // Names by id with the service role (the page is gated above).
  const ids = [...new Set(rows.map((r) => r.user_id).filter((u): u is string => Boolean(u)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await createAdminClient().from("profiles").select("id, first_name, last_name, email").in("id", ids);
    for (const p of profiles ?? []) {
      names.set(p.id as string, [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || (p.email as string) || "Unnamed");
    }
  }
  const sorted = [...rows].sort(
    (a, b) => ORDER.indexOf(a.room_request_status ?? "pending") - ORDER.indexOf(b.room_request_status ?? "pending"),
  );
  const approved = rows.filter((r) => r.room_request_status === "approved").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{retreat.name as string}: room requests</h1>
        <p className="text-sm text-muted-foreground">
          {formatEventDateRange(retreat.starts_at as string, retreat.ends_at as string | null, timezone)}
        </p>
        <RetreatAdminNav eventId={eventId} current="rooms" />
      </div>
      <p className="text-sm text-muted-foreground">
        {rows.length === 0
          ? "Nobody has asked for their own room."
          : `${rows.length} ${rows.length === 1 ? "request" : "requests"}, ${approved} approved. Each person sees their request's status on their registration, and gets an email when it's approved or declined. Changing their reason sends it back to pending.`}
      </p>
      {sorted.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r) => {
            const status = r.room_request_status ?? "pending";
            return (
              <Card key={r.id} className={cn("border-l-4", TONES[status])}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {r.user_id ? names.get(r.user_id) ?? "Unnamed" : "Account removed"}
                    <Badge variant={status === "pending" ? "outline" : "secondary"}>{ROOM_STATUS_LABELS[status]}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {STATUS_LABELS[r.status]} · registered {formatEventInstant(r.registered_at, timezone)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p className="whitespace-pre-wrap">{r.room_request_reason}</p>
                  <RoomDecision registrationId={r.id} status={status} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RetreatRoomsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RoomsLoader params={params} />
      </Suspense>
    </div>
  );
}
