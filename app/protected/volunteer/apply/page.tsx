import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { formatDateInZone } from "@/lib/format-date";
import { formatPhoneNumber } from "@/lib/phone";
import {
  APPLICATION_STATUS_FOR_APPLICANT,
  CLOSED_STATUSES,
  type ApplicationStatus,
  type InterestArea,
} from "@/lib/volunteer-applications";
import { VolunteerApplicationForm } from "@/components/volunteer-application-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

async function ApplyLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/auth/login");
  const userId = data.claims.sub as string;

  const [{ data: volunteer }, { data: applications }] = await Promise.all([
    supabase.from("volunteers").select("status").eq("user_id", userId).maybeSingle(),
    supabase.rpc("my_volunteer_applications"),
  ]);

  if (volunteer && ["invited", "registered", "approved"].includes(volunteer.status as string)) {
    return (
      <p className="text-sm">
        You&apos;re already on the volunteer team —{" "}
        <Link href="/protected/volunteer" className="underline underline-offset-4">
          go to your volunteer page
        </Link>
        .
      </p>
    );
  }
  const mine = (applications ?? []) as { id: number; status: ApplicationStatus; reapplication_allowed: boolean }[];
  const open = mine.find((a) => !CLOSED_STATUSES.includes(a.status));
  // A decline stands until an admin allows re-application (the database
  // refuses a new application too).
  if (mine[0]?.status === "declined" && !mine[0].reapplication_allowed) {
    return <p className="text-sm text-muted-foreground">{APPLICATION_STATUS_FOR_APPLICANT.declined}</p>;
  }
  if (open) {
    return (
      <p className="text-sm">
        {APPLICATION_STATUS_FOR_APPLICANT[open.status]}{" "}
        <Link href="/protected/volunteer" className="underline underline-offset-4">
          See your application
        </Link>
        .
      </p>
    );
  }

  const [{ data: profile }, { data: interestAreas }, { data: attendedRows }, { data: total }, { data: settings }] =
    await Promise.all([
      supabase.from("profiles").select("first_name, last_name, email, phone").eq("id", userId).maybeSingle(),
      supabase
        .from("volunteer_interest_areas")
        .select("id, kind, label, description")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("rsvps")
        .select("event:events(id, name, starts_at, timezone)")
        .eq("user_id", userId)
        .not("checked_in_at", "is", null),
      supabase.rpc("my_attendance_total"),
      supabase.from("app_settings").select("min_events_before_screening").maybeSingle(),
    ]);

  const attended = ((attendedRows ?? []) as unknown as {
    event: { id: number; name: string; starts_at: string; timezone: string } | null;
  }[])
    .map((r) => r.event)
    .filter((e): e is NonNullable<typeof e> => e != null)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const totalAttended = typeof total === "number" ? total : attended.length;
  const beforePortal = Math.max(totalAttended - attended.length, 0);
  const minimum = (settings?.min_events_before_screening as number | undefined) ?? 2;
  const contact = {
    fullName: [profile?.first_name, profile?.last_name].filter(Boolean).join(" "),
    email: (profile?.email as string | null) ?? (data.claims.email as string | undefined) ?? "",
    phone: formatPhoneNumber((profile?.phone as string | null) ?? ""),
  };

  return (
    <div className="flex flex-col gap-6">
      {mine[0]?.status === "withdrawn" && (
        <p className="text-sm text-muted-foreground">
          You withdrew your last application — you&apos;re welcome to apply again.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Events you&apos;ve attended</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-semibold">{totalAttended}</span>{" "}
            {totalAttended === 1 ? "event" : "events"} so far
            {beforePortal > 0 ? `, including ${beforePortal} from before we started checking people in here` : ""}.
          </p>
          {attended.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {attended.map((e) => (
                <li key={e.id}>
                  {e.name} · {formatDateInZone(e.starts_at, e.timezone)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground">
            We normally ask people to come to a few events first (usually {minimum}) before we set up a
            call — but you&apos;re welcome to apply now. If you&apos;re still getting to know us,
            we&apos;ll hold onto your application and pick it up once you&apos;ve been to a few more.
          </p>
        </CardContent>
      </Card>

      <VolunteerApplicationForm
        // The App Router keeps a visited page's form state alive; keyed on
        // the profile values so a name or phone saved on the profile since
        // (e.g. after first opening this page) prefills instead of the stale
        // empty field.
        key={`${contact.fullName}|${contact.email}|${contact.phone}`}
        interestAreas={(interestAreas ?? []) as Pick<InterestArea, "id" | "kind" | "label" | "description">[]}
        contact={contact}
      />
    </div>
  );
}

export default function ApplyPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Apply to volunteer</h1>
        <p className="text-sm text-muted-foreground">
          Volunteers help run our events on and off the water. After you apply, we&apos;ll set up a
          short call, check in with your references, and talk about which roles fit.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <ApplyLoader />
      </Suspense>
    </div>
  );
}
