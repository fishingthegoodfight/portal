import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { certIsCurrent, VOLUNTEER_STATUS_LABELS, type VolunteerStatus } from "@/lib/volunteers";
import { formatEventDateRange } from "@/lib/format-date";
import { VolunteerShiftsList, type VolunteerShift } from "@/components/volunteer-shifts-list";

async function VolunteerHomeLoader({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }
  const userId = data.claims.sub as string;

  const [{ data: volunteer }, { data: profile }] = await Promise.all([
    supabase.from("volunteers").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("program_interests").eq("id", userId).maybeSingle(),
  ]);

  // Reachable only by someone with a volunteers row — same rule as the
  // registration form itself.
  if (!volunteer) {
    return (
      <div className="max-w-md">
        <h1 className="mb-2 text-2xl font-bold">Volunteer</h1>
        <p className="text-sm text-muted-foreground">
          Volunteer registration is by invitation only. If you&apos;d like to volunteer with
          Fishing the Good Fight, contact{" "}
          <a href="mailto:tcramer@fishingthegoodfight.org" className="underline underline-offset-4">
            tcramer@fishingthegoodfight.org
          </a>
          .
        </p>
      </div>
    );
  }

  const [{ data: approvals }, { data: certs }] = await Promise.all([
    supabase
      .from("volunteer_role_approvals")
      .select("id, role_type:volunteer_role_types(name)")
      .eq("volunteer_id", userId)
      .is("revoked_at", null),
    supabase
      .from("volunteer_certifications")
      .select("id, kind, issued_on, expires_on")
      .eq("volunteer_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const approvedRoles = ((approvals ?? []) as unknown as { id: number; role_type: { name: string } | null }[])
    .map((a) => a.role_type?.name)
    .filter((name): name is string => Boolean(name));

  const wantsRetreats = (profile?.program_interests as string[] | null)?.includes("Retreats") ?? false;
  const certList = (certs ?? []) as { id: number; kind: string; issued_on: string | null; expires_on: string | null }[];
  const hasCurrentCert = certList.some((c) => certIsCurrent(c));

  const outstanding: string[] = [];
  if (volunteer.health_history_outstanding) outstanding.push("Health history");
  if (wantsRetreats && !hasCurrentCert) {
    outstanding.push(
      certList.length > 0
        ? "Certification renewal (First Aid/CPR/AED expired)"
        : "First Aid/CPR/AED certification",
    );
  }

  const status = volunteer.status as VolunteerStatus;

  const { data: signupRows } = await supabase
    .from("volunteer_signups")
    .select(
      "id, opportunity_id, opportunity:volunteer_opportunities(id, role, shift_start, shift_end, event:events(id, name, timezone))",
    )
    .eq("user_id", userId)
    .eq("status", "confirmed");

  const now = Date.now();
  const shiftsWithStart: (VolunteerShift & { shiftStart: string })[] = [];
  for (const row of (signupRows ?? []) as unknown as {
    opportunity: {
      id: number;
      role: string;
      shift_start: string;
      shift_end: string;
      event: { id: number; name: string; timezone: string } | null;
    } | null;
  }[]) {
    const opportunity = row.opportunity;
    if (!opportunity?.event) continue;
    shiftsWithStart.push({
      opportunityId: opportunity.id,
      eventId: opportunity.event.id,
      eventName: opportunity.event.name,
      role: opportunity.role,
      shiftLabel: formatEventDateRange(
        opportunity.shift_start,
        opportunity.shift_end,
        opportunity.event.timezone,
      ),
      shiftStart: opportunity.shift_start,
    });
  }

  const upcomingShifts = shiftsWithStart
    .filter((s) => new Date(s.shiftStart).getTime() >= now)
    .sort((a, b) => a.shiftStart.localeCompare(b.shiftStart));
  const pastShifts = shiftsWithStart
    .filter((s) => new Date(s.shiftStart).getTime() < now)
    .sort((a, b) => b.shiftStart.localeCompare(a.shiftStart));

  return (
    <div className="flex flex-col gap-6">
      {saved === "1" && (
        <div className="flex items-center gap-3 rounded-md bg-accent p-3 px-5 text-sm text-foreground">
          <CheckCircle2 size={16} strokeWidth={2} />
          Registration saved — thank you!
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Volunteer</h1>
          <p className="text-sm text-muted-foreground">Your volunteer status with Fishing the Good Fight.</p>
        </div>
        <Badge variant="secondary">{VOLUNTEER_STATUS_LABELS[status] ?? status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your shifts</CardTitle>
        </CardHeader>
        <CardContent>
          <VolunteerShiftsList upcoming={upcomingShifts} past={pastShifts} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approved roles</CardTitle>
        </CardHeader>
        <CardContent>
          {approvedRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles approved yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {approvedRoles.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outstanding</CardTitle>
        </CardHeader>
        <CardContent>
          {outstanding.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-amber-600">
              {outstanding.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {certList.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 text-sm text-muted-foreground">
              {certList.map((c) => (
                <p key={c.id}>
                  First Aid/CPR/AED — issued {c.issued_on ?? "—"}, expires {c.expires_on ?? "—"}
                  {" · "}
                  {certIsCurrent(c) ? "current" : "expired"}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <Button asChild variant="outline">
          <Link href="/protected/volunteer/register">Edit your registration</Link>
        </Button>
      </div>
    </div>
  );
}

export default function VolunteerHomePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <VolunteerHomeLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
