import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { certIsCurrent, VOLUNTEER_STATUS_LABELS, type VolunteerStatus } from "@/lib/volunteers";
import { formatDateInZone, formatEventDateRange } from "@/lib/format-date";
import { VolunteerShiftsList, type VolunteerShift } from "@/components/volunteer-shifts-list";
import { loadOpenShiftsForVolunteer } from "@/lib/volunteer-signups";
import { eventsNeedingHealthForm } from "@/lib/health-requirements";
import {
  APPLICATION_STATUS_FOR_APPLICANT,
  CLOSED_STATUSES,
  type ApplicationStatus,
} from "@/lib/volunteer-applications";
import { WithdrawApplicationButton } from "@/components/withdraw-application-button";

async function VolunteerHomeLoader({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; applied?: string }>;
}) {
  const { saved, applied } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }
  const userId = data.claims.sub as string;

  const [{ data: volunteer }, { data: profile }] = await Promise.all([
    supabase.from("volunteers").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("program_interests, chapter").eq("id", userId).maybeSingle(),
  ]);

  // Not on the team yet: their application's status, or a way to apply.
  // (Admin invites still create a volunteers row directly, as before.)
  if (!volunteer) {
    const { data: applications } = await supabase.rpc("my_volunteer_applications");
    const latest = ((applications ?? []) as {
      id: number;
      status: ApplicationStatus;
      submitted_at: string;
      reapplication_allowed: boolean;
    }[])[0];
    const open = latest && !CLOSED_STATUSES.includes(latest.status) ? latest : null;
    // After a decline: no Apply button and nothing about applying again,
    // until an admin chooses "Allow re-application".
    const declinedHold = latest?.status === "declined" && !latest.reapplication_allowed;
    return (
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-2xl font-bold">Volunteer</h1>
        {applied && open && (
          <p className="rounded-md bg-accent p-3 text-sm">Thanks — your application is in.</p>
        )}
        {declinedHold ? (
          <>
            <p className="text-sm text-muted-foreground">{APPLICATION_STATUS_FOR_APPLICANT.declined}</p>
            <ViewApplicationLink id={latest.id} />
          </>
        ) : open ? (
          <>
            <p className="text-sm">
              <span className="font-medium">Your application</span> (sent{" "}
              {formatDateInZone(open.submitted_at, "America/Denver")}):{" "}
              {APPLICATION_STATUS_FOR_APPLICANT[open.status]}
            </p>
            <ViewApplicationLink id={open.id} />
            <WithdrawApplicationButton applicationId={open.id} />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Volunteers help run our events on and off the water. If you&apos;d like to be one,
              we&apos;d love to hear from you.
              {latest?.status === "withdrawn" && " You withdrew your last application — you're welcome to apply again."}
            </p>
            <div>
              <Button asChild>
                <Link href="/protected/volunteer/apply">Apply to volunteer</Link>
              </Button>
            </div>
          </>
        )}
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
  // Only for shifts at events that require one (the same rule as for
  // participants) — not for volunteering as such.
  const healthNeeded = (await eventsNeedingHealthForm(supabase, userId)).filter((e) => !e.opensLater);
  if (healthNeeded.length > 0) {
    outstanding.push(
      `${healthNeeded[0].year} health form — needed for ${healthNeeded.map((e) => e.name).join(", ")}`,
    );
  }
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

  // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request on the server (after awaiting request data), so there's no re-render or hydration to disagree with this timestamp.
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

  // Every open shift across upcoming events in a role they're approved for —
  // empty for anyone not approved (loadOpenShiftsForVolunteer checks).
  const openShifts = status === "approved" ? await loadOpenShiftsForVolunteer(supabase, userId) : [];

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

      {status === "approved" && (
        <Card>
          <CardHeader>
            <CardTitle>Open shifts you can fill</CardTitle>
          </CardHeader>
          <CardContent>
            {openShifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open shifts in your roles right now — check back soon.
              </p>
            ) : (
              <ul>
                {openShifts.map((shift) => (
                  <li
                    key={shift.opportunityId}
                    className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-0.5">
                      <Link
                        href={`/protected/events/${shift.event.id}/rsvp`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {shift.event.name}
                      </Link>
                      <span className="text-sm text-muted-foreground">
                        {shift.role} ·{" "}
                        {formatEventDateRange(shift.shiftStart, shift.shiftEnd, shift.event.timezone)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {shift.spotsRemaining} spot{shift.spotsRemaining === 1 ? "" : "s"} left
                      </span>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/protected/events/${shift.event.id}/rsvp`}>Sign up</Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Approved roles</CardTitle>
        </CardHeader>
        <CardContent>
          {approvedRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles approved yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {/* A role approval only lets someone sign up once their
                * registration itself is approved (lib/volunteer-signups.ts). */}
              {status !== "approved" && (
                <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  {status === "invited" || status === "registered" ? (
                    <>
                      Your volunteer registration is still under review. You&apos;ll be able to
                      sign up for shifts in these roles once it&apos;s approved.
                    </>
                  ) : (
                    <>
                      Your volunteer status is {VOLUNTEER_STATUS_LABELS[status] ?? status}, so you
                      can&apos;t sign up for shifts right now. Contact{" "}
                      <a
                        href="mailto:tcramer@fishingthegoodfight.org"
                        className="underline underline-offset-4"
                      >
                        tcramer@fishingthegoodfight.org
                      </a>{" "}
                      with any questions.
                    </>
                  )}
                </p>
              )}
              <ul className="flex flex-col gap-1 text-sm">
                {approvedRoles.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
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
          {healthNeeded.length > 0 && (
            <Button asChild size="sm" className="mt-3">
              <Link href="/protected/profile/medical/new?next=/protected/volunteer">
                Complete your health form
              </Link>
            </Button>
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
  searchParams: Promise<{ saved?: string; applied?: string }>;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <VolunteerHomeLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** To the applicant's own read-only application. */
function ViewApplicationLink({ id }: { id: number }) {
  return (
    <Link href={`/protected/volunteer/application/${id}`} className="w-fit text-sm underline underline-offset-4">
      View your application
    </Link>
  );
}
